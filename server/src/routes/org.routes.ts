import { Router, Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission, isGlobalAdmin } from "../middleware/auth";
import { VISIBLE } from "../services/accountLifecycle";

type ReqUser = NonNullable<Request["user"]>;

// ============================ OFFICES ============================
export const officeRouter = Router();
officeRouter.use(authenticate);

/** What your OWN office (or a Super Admin) may see: everything. */
const officeFullSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  email: true,
  isActive: true,
  head: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } },
  _count: { select: { departments: true, users: true, owningTasks: true, projects: true } },
} as const;

/**
 * What ANOTHER office may see: the name, where it is, who heads it, and the
 * office mailbox. That is everything you need in order to route work to them
 * and nothing you could use to go around them. No headcount, no departments,
 * no staff, and not the head's personal email either.
 */
const officeForeignSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  email: true,
  isActive: true,
  head: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } } } },
} as const;

/** Is this office the caller's own? */
function isOwnOffice(user: ReqUser, officeId: string): boolean {
  return isGlobalAdmin(user) || user.officeId === officeId || user.headsOfficeIds.includes(officeId);
}

// GET /api/offices  -  the directory. Your own office comes back in full; every
// other office comes back as name, city, head and mailbox, which is what you
// need to send them work and no more.
officeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (isGlobalAdmin(user)) {
      const all = await prisma.office.findMany({ orderBy: { name: "asc" }, select: officeFullSelect });
      return res.json(all);
    }

    const [mine, others] = await Promise.all([
      user.officeId
        ? prisma.office.findMany({ where: { id: user.officeId }, select: officeFullSelect })
        : Promise.resolve([]),
      prisma.office.findMany({
        where: { isActive: true, ...(user.officeId ? { id: { not: user.officeId } } : {}) },
        orderBy: { name: "asc" },
        select: officeForeignSelect,
      }),
    ]);
    res.json([...mine, ...others]);
  })
);

// GET /api/offices/:id  -  one office. Departments are part of an office's
// internal structure, so they are only included for your own office.
officeRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const own = isOwnOffice(req.user!, req.params.id);
    const office = await prisma.office.findUnique({
      where: { id: req.params.id },
      select: own
        ? { ...officeFullSelect, departments: { select: { id: true, name: true, code: true }, orderBy: { name: "asc" as const } } }
        : officeForeignSelect,
    });
    if (!office) throw new HttpError(404, "Office not found");
    res.json(office);
  })
);

/**
 * GET /api/offices/:id/members  -  the roster of an office.
 *
 * Your own office only. Another office's staff list is theirs: you route work
 * to the office and their head nominates the person. Before this check, any
 * signed-in user could pull any office's full roster with email addresses.
 */
officeRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    if (!isOwnOffice(req.user!, req.params.id)) {
      throw new HttpError(403, "You can only view the staff of your own office");
    }
    const members = await prisma.user.findMany({
      where: { ...VISIBLE, officeId: req.params.id, isActive: true },
      orderBy: [{ role: { level: "desc" } }, { fullName: "asc" }],
      take: 500,
      select: {
        id: true,
        fullName: true,
        email: true,
        designation: { select: { id: true, name: true, code: true, rank: true } },
        wing: true,
        role: { select: { id: true, name: true, level: true } },
        department: { select: { id: true, name: true } },
      },
    });
    res.json(members);
  })
);

/**
 * Office creation lives ONLY on POST /api/superadmin/offices, because an office
 * and its Office Admin login are created together in one act. A bare office
 * with no admin is not a usable state, so the old duplicate endpoint that
 * created one has been removed.
 */

// ============================ DEPARTMENTS ============================
export const departmentRouter = Router();
departmentRouter.use(authenticate);

/**
 * Can this user manage this department? A Super Admin anywhere; otherwise you
 * must be inside the same office AND either hold department.manage or be the
 * department's own head. The office check is the important half: holding
 * department.manage does not let an admin reach into another office.
 */
function canManageDept(user: ReqUser, dept: { headId: string | null; officeId: string | null }): boolean {
  if (isGlobalAdmin(user)) return true;
  if (dept.officeId !== user.officeId) return false;
  return user.permissions.includes("department.manage") || dept.headId === user.id;
}

const deptSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  officeId: true,
  parentId: true,
  office: { select: { id: true, name: true } },
  parent: { select: { id: true, name: true } },
  head: { select: { id: true, fullName: true, designation: true } },
  _count: { select: { members: true, children: true } },
} as const;

// GET /api/departments?officeId=  -  visible to all signed-in users
departmentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const requested = req.query.officeId as string | undefined;
    // Default to your own office; only a Super Admin may look at another's.
    const officeId = isGlobalAdmin(req.user!) ? requested : req.user!.officeId ?? undefined;
    const departments = await prisma.department.findMany({
      where: officeId ? { officeId } : isGlobalAdmin(req.user!) ? undefined : { id: "__none__" },
      orderBy: { name: "asc" },
      select: deptSelect,
    });
    res.json(departments);
  })
);

const createSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  description: z.string().optional(),
  officeId: z.string().optional(),
  parentId: z.string().optional(),
  headId: z.string().optional(),
});

// POST /api/departments
departmentRouter.post(
  "/",
  requirePermission("department.manage"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    // A non-global admin creates only inside their own office, whatever the
    // request body claims.
    const officeId = isGlobalAdmin(req.user!) ? data.officeId ?? req.user!.officeId : req.user!.officeId;
    if (!officeId) throw new HttpError(400, "No office to create this department in");
    if (!isGlobalAdmin(req.user!) && data.officeId && data.officeId !== officeId) {
      throw new HttpError(403, "You can only create departments inside your own office");
    }
    const dept = await prisma.department.create({
      data: { ...data, officeId },
      select: deptSelect,
    });
    res.status(201).json(dept);
  })
);

// GET /api/departments/:id  -  detail with members and children
departmentRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      select: {
        ...deptSelect,
        children: { select: { id: true, name: true } },
        members: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true }, orderBy: { fullName: "asc" } },
      },
    });
    if (!dept) throw new HttpError(404, "Department not found");
    res.json(dept);
  })
);

const updateSchema = createSchema.partial();

// PATCH /api/departments/:id  -  global managers or the department head
departmentRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      select: { id: true, headId: true, officeId: true },
    });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    const data = updateSchema.parse(req.body);
    // A department can never be moved into another office by editing it.
    if (data.officeId && data.officeId !== dept.officeId && !isGlobalAdmin(req.user!)) {
      throw new HttpError(403, "A department cannot be moved to another office");
    }
    const updated = await prisma.department.update({ where: { id: dept.id }, data, select: deptSelect });
    res.json(updated);
  })
);

/**
 * DELETE /api/departments/:id  -  remove an empty department.
 *
 * Refused while anything still points at it, and the message says exactly what,
 * because the alternative (cascading) would silently detach people from their
 * wing or orphan work items. Empty out the department first, then delete it.
 */
departmentRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        headId: true,
        officeId: true,
        _count: { select: { members: true, children: true, tasks: true, projects: true, incomingRequests: true } },
      },
    });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");

    const blockers: string[] = [];
    if (dept._count.members) blockers.push(`${dept._count.members} member(s)`);
    if (dept._count.children) blockers.push(`${dept._count.children} sub-department(s)`);
    if (dept._count.tasks) blockers.push(`${dept._count.tasks} work item(s)`);
    if (dept._count.projects) blockers.push(`${dept._count.projects} project(s)`);
    if (dept._count.incomingRequests) blockers.push(`${dept._count.incomingRequests} pending request(s)`);

    if (blockers.length) {
      throw new HttpError(
        400,
        `"${dept.name}" still has ${blockers.join(", ")}. Move or remove them first, then delete the department.`
      );
    }

    await prisma.department.delete({ where: { id: dept.id } });
    res.status(204).end();
  })
);

const memberSchema = z.object({ userId: z.string() });

// POST /api/departments/:id/members  -  assign a user to this department
departmentRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      select: { id: true, headId: true, officeId: true },
    });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    const { userId } = memberSchema.parse(req.body);
    // You may only place someone from this office into this office's department.
    const candidate = await prisma.user.findUnique({ where: { id: userId }, select: { officeId: true } });
    if (!candidate) throw new HttpError(404, "User not found");
    if (candidate.officeId !== dept.officeId) throw new HttpError(400, "That person belongs to a different office");
    const user = await prisma.user.update({
      where: { id: userId },
      data: { departmentId: dept.id },
      select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true },
    });
    res.status(201).json(user);
  })
);

// DELETE /api/departments/:id/members/:userId  -  remove a user from the department
departmentRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      select: { id: true, headId: true, officeId: true },
    });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    await prisma.user.updateMany({ where: { id: req.params.userId, departmentId: dept.id }, data: { departmentId: null } });
    res.status(204).end();
  })
);
