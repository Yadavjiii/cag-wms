import { Router, Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission, isGlobalAdmin, assertOfficeScope } from "../middleware/auth";
import { createAccount, createAccountSchema, accountSelect, resetPassword } from "../services/provisioning";
import { deleteAccount } from "../services/accountLifecycle";
import { VISIBLE } from "../services/accountLifecycle";

/**
 * Office Admin surface: create and manage the logins for one office's staff
 * (DG, DAG, SAOs, AAOs, Senior Auditors, Supervisors, consultants and so on).
 * Every route is pinned to the caller's own office unless they are a Super
 * Admin, who may pass ?officeId= to work on any office.
 */
export const staffRouter = Router();
staffRouter.use(authenticate);
staffRouter.use(requirePermission("staff.manage"));

/** Which office is this request operating on? */
function targetOffice(req: Request): string {
  const user = req.user!;
  const requested = (req.query.officeId ?? req.body?.officeId) as string | undefined;
  if (isGlobalAdmin(user)) {
    const id = requested ?? user.officeId;
    if (!id) throw new HttpError(400, "officeId is required");
    return id;
  }
  if (!user.officeId) throw new HttpError(403, "Your account is not attached to an office");
  if (requested && requested !== user.officeId) throw new HttpError(403, "You can only manage your own office");
  return user.officeId;
}

// GET /api/staff  -  the roster for my office
staffRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const officeId = targetOffice(req);
    const q = String(req.query.q ?? "").trim();
    const includeInactive = req.query.includeInactive === "true";

    const staff = await prisma.user.findMany({
      where: {
        ...VISIBLE,
        officeId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(q ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { employeeId: { contains: q } }, { designation: { name: { contains: q } } }] } : {}),
      },
      orderBy: [{ role: { level: "desc" } }, { fullName: "asc" }],
      take: 1000,
      select: accountSelect,
    });
    res.json(staff);
  })
);

/**
 * GET /api/staff/assignable-roles  -  roles this admin may hand out.
 *
 * Three filters, all of them load-bearing:
 *   1. Below my own level      - anti-escalation.
 *   2. A platform template OR my own office's role - without this, the dropdown
 *      listed every other office's custom roles too, which both leaked their
 *      internal structure and made the list ambiguous.
 *   3. Not a platform role     - office.manage_all is never assignable here.
 */
staffRouter.get(
  "/assignable-roles",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const roles = await prisma.role.findMany({
      where: isGlobalAdmin(user)
        ? {}
        : {
            level: { lt: user.level },
            OR: [{ officeId: null }, { officeId: user.officeId ?? "__none__" }],
            NOT: { permissions: { some: { permission: { key: "office.manage_all" } } } },
          },
      orderBy: [{ level: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, level: true, officeId: true },
    });
    res.json(roles);
  })
);

// POST /api/staff  -  create a staff login. Returns the temp password ONCE.
staffRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createAccountSchema.parse(req.body);
    const officeId = targetOffice(req);
    const result = await createAccount(req.user!, { ...body, officeId });
    res.status(201).json(result);
  })
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  designationId: z.string().nullable().optional(),
  wing: z.string().optional(),
  employeeId: z.string().optional(),
  mobile: z.string().optional(),
  roleId: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Load a staff member and confirm the caller may touch them. */
async function loadStaff(req: Request) {
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, officeId: true, deletedAt: true, role: { select: { level: true } } },
  });
  if (!target || target.deletedAt) throw new HttpError(404, "Staff member not found");
  assertOfficeScope(req.user!, target.officeId);
  if (!isGlobalAdmin(req.user!) && (target.role?.level ?? 0) >= req.user!.level) {
    throw new HttpError(403, "You cannot manage an account at or above your own level");
  }
  return target;
}

// PATCH /api/staff/:id  -  edit designation, role, department, reporting line
staffRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const target = await loadStaff(req);
    const data = updateSchema.parse(req.body);

    if (req.params.id === req.user!.id && data.isActive === false) {
      throw new HttpError(400, "You cannot deactivate your own account");
    }

    // Anti-escalation on the new role, same rule as on creation.
    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId }, select: { name: true, level: true } });
      if (!role) throw new HttpError(404, "Role not found");
      if (!isGlobalAdmin(req.user!) && role.level >= req.user!.level) {
        throw new HttpError(403, `You cannot grant the "${role.name}" role`);
      }
    }

    // Department and manager must stay inside the same office.
    if (data.departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: data.departmentId }, select: { officeId: true } });
      if (dept?.officeId !== target.officeId) throw new HttpError(400, "That department belongs to a different office");
    }
    if (data.managerId) {
      if (data.managerId === target.id) throw new HttpError(400, "Someone cannot report to themselves");
      const mgr = await prisma.user.findUnique({ where: { id: data.managerId }, select: { officeId: true } });
      if (mgr?.officeId !== target.officeId) throw new HttpError(400, "The reporting manager belongs to a different office");
    }

    const updated = await prisma.user.update({ where: { id: target.id }, data, select: accountSelect });
    res.json(updated);
  })
);

// POST /api/staff/:id/reset-password  -  hand out a fresh temporary password
staffRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    await loadStaff(req);
    res.json(await resetPassword(req.user!, req.params.id));
  })
);

/**
 * DELETE /api/staff/:id  -  delete a staff account.
 *
 * The person disappears from the office: gone from the roster, from search,
 * from every assignee and member picker, and unable to sign in. Their name
 * still resolves on the work they did, which is what keeps the audit trail
 * readable. See services/accountLifecycle.ts.
 */
staffRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const target = await loadStaff(req);
    res.json(await deleteAccount(req.user!, target.id));
  })
);

// PATCH /api/staff/:id/active  -  suspend without deleting
staffRouter.patch(
  "/:id/active",
  asyncHandler(async (req, res) => {
    const target = await loadStaff(req);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    if (target.id === req.user!.id && !isActive) throw new HttpError(400, "You cannot suspend your own account");
    const user = await prisma.user.update({ where: { id: target.id }, data: { isActive }, select: accountSelect });
    res.json(user);
  })
);
