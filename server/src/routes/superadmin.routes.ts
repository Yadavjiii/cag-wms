import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission } from "../middleware/auth";
import { createAccount, createAccountSchema, accountSelect, resetPassword } from "../services/provisioning";
import { notify } from "../services/notify";

/**
 * Super Admin surface. Everything here is gated on "office.manage_all", the
 * permission that lifts the office boundary. This is the only place an Office
 * Admin account can be created.
 */
export const superAdminRouter = Router();
superAdminRouter.use(authenticate);
superAdminRouter.use(requirePermission("office.manage_all"));

const officeSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  head: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } },
  // Office no longer has a single `tasks` relation: work items carry an
  // owning office and an executing office. Count what the office OWNS, since
  // that is what it is accountable for.
  _count: { select: { users: true, departments: true, owningTasks: true, projects: true } },
} as const;

// GET /api/superadmin/offices  -  every office, active or not
superAdminRouter.get(
  "/offices",
  asyncHandler(async (_req, res) => {
    const offices = await prisma.office.findMany({ orderBy: { name: "asc" }, select: officeSelect });
    res.json(offices);
  })
);

const officeSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).optional(),
  city: z.string().optional(),
});

// POST /api/superadmin/offices  -  register a new CAG office
superAdminRouter.post(
  "/offices",
  asyncHandler(async (req, res) => {
    const data = officeSchema.parse(req.body);
    if (data.code) {
      const clash = await prisma.office.findUnique({ where: { code: data.code }, select: { id: true } });
      if (clash) throw new HttpError(409, "An office with that code already exists");
    }
    const office = await prisma.office.create({ data, select: officeSelect });
    res.status(201).json(office);
  })
);

const officeUpdateSchema = officeSchema.partial().extend({
  headId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// DELETE /api/superadmin/offices/:id  -  archive, never destroy.
// Deleting an office would take years of audit trail with it, which contradicts
// the whole point of the system. Archived offices stay fully readable.
superAdminRouter.delete(
  "/offices/:id",
  asyncHandler(async (req, res) => {
    const office = await prisma.office.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, _count: { select: { users: true } } },
    });
    if (!office) throw new HttpError(404, "Office not found");

    await prisma.office.update({
      where: { id: office.id },
      data: { archivedAt: new Date(), isActive: false },
    });
    // Everyone in an archived office loses their login, but their records stay.
    await prisma.user.updateMany({ where: { officeId: office.id }, data: { isActive: false } });

    res.json({
      archived: true,
      message: `${office.name} archived. ${office._count.users} accounts were deactivated; nothing was deleted.`,
    });
  })
);

// POST /api/superadmin/offices/:id/restore
superAdminRouter.post(
  "/offices/:id/restore",
  asyncHandler(async (req, res) => {
    const office = await prisma.office.update({
      where: { id: req.params.id },
      data: { archivedAt: null, isActive: true },
      select: officeSelect,
    });
    res.json(office);
  })
);

// PATCH /api/superadmin/offices/:id  -  rename, deactivate, or appoint the head
superAdminRouter.patch(
  "/offices/:id",
  asyncHandler(async (req, res) => {
    const office = await prisma.office.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!office) throw new HttpError(404, "Office not found");

    const data = officeUpdateSchema.parse(req.body);

    // The head must actually work in the office they are being put in charge of.
    if (data.headId) {
      const head = await prisma.user.findUnique({ where: { id: data.headId }, select: { officeId: true } });
      if (!head) throw new HttpError(404, "That user does not exist");
      if (head.officeId !== office.id) throw new HttpError(400, "The head must be a member of this office");
    }

    const updated = await prisma.office.update({ where: { id: office.id }, data, select: officeSelect });
    if (data.headId) {
      await notify({
        userId: data.headId,
        kind: "office_head_appointed",
        title: `You are now head of ${updated.name}`,
        body: "Work requests from other offices will come to you for approval.",
      });
    }
    res.json(updated);
  })
);

// GET /api/superadmin/offices/:id/admins  -  who administers this office
superAdminRouter.get(
  "/offices/:id/admins",
  asyncHandler(async (req, res) => {
    const admins = await prisma.user.findMany({
      where: {
        officeId: req.params.id,
        role: { permissions: { some: { permission: { key: "staff.manage" } } } },
      },
      orderBy: { fullName: "asc" },
      select: accountSelect,
    });
    res.json(admins);
  })
);

const officeAdminSchema = createAccountSchema.omit({ officeId: true, roleId: true }).extend({
  /** Optional override; defaults to the seeded "Office Admin" role. */
  roleId: z.string().optional(),
});

// POST /api/superadmin/offices/:id/admins  -  mint the office admin login
superAdminRouter.post(
  "/offices/:id/admins",
  asyncHandler(async (req, res) => {
    const body = officeAdminSchema.parse(req.body);

    let roleId = body.roleId;
    if (!roleId) {
      // Default to whichever role carries staff.manage, i.e. the Office Admin role.
      const role = await prisma.role.findFirst({
        where: { permissions: { some: { permission: { key: "staff.manage" } } } },
        orderBy: { level: "desc" },
        select: { id: true },
      });
      if (!role) throw new HttpError(500, 'No role grants "staff.manage". Re-run the seed.');
      roleId = role.id;
    }

    const result = await createAccount(req.user!, { ...body, roleId, officeId: req.params.id });
    res.status(201).json(result);
  })
);

// GET /api/superadmin/users  -  every account across every office
superAdminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const officeId = req.query.officeId as string | undefined;
    const users = await prisma.user.findMany({
      where: {
        ...(officeId ? { officeId } : {}),
        ...(q ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { employeeId: { contains: q } }] } : {}),
      },
      orderBy: [{ office: { name: "asc" } }, { fullName: "asc" }],
      take: 1000,
      select: accountSelect,
    });
    res.json(users);
  })
);

// POST /api/superadmin/users/:id/reset-password
superAdminRouter.post(
  "/users/:id/reset-password",
  asyncHandler(async (req, res) => {
    res.json(await resetPassword(req.user!, req.params.id));
  })
);

// PATCH /api/superadmin/users/:id/active  -  suspend or restore any account
superAdminRouter.patch(
  "/users/:id/active",
  asyncHandler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    if (req.params.id === req.user!.id) throw new HttpError(400, "You cannot deactivate your own account");
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive }, select: accountSelect });
    res.json(user);
  })
);
