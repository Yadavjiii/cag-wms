import { Router, Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission, isGlobalAdmin } from "../middleware/auth";

type ReqUser = NonNullable<Request["user"]>;

// ============================ OFFICES ============================
export const officeRouter = Router();
officeRouter.use(authenticate);

const officeDirectorySelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  isActive: true,
  head: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } },
  _count: { select: { departments: true, users: true, owningTasks: true, projects: true } },
} as const;

// GET /api/offices  -  the directory of registered CAG offices. Every signed-in
// user can see which offices exist and who heads them, because that is exactly
// the information you need before asking another office to take on work.
officeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const offices = await prisma.office.findMany({
      where: isGlobalAdmin(req.user!) ? {} : { isActive: true },
      orderBy: { name: "asc" },
      select: officeDirectorySelect,
    });
    res.json(offices);
  })
);

// GET /api/offices/:id  -  one office with its departments and its head
officeRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const office = await prisma.office.findUnique({
      where: { id: req.params.id },
      select: {
        ...officeDirectorySelect,
        departments: { select: { id: true, name: true, code: true }, orderBy: { name: "asc" } },
      },
    });
    if (!office) throw new HttpError(404, "Office not found");
    res.json(office);
  })
);

// GET /api/offices/:id/members  -  the roster of an office. Heads browse this
// when deciding who to nominate for incoming work.
officeRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const members = await prisma.user.findMany({
      where: { officeId: req.params.id, isActive: true },
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

const officeSchema = z.object({ name: z.string().min(2), code: z.string().optional(), city: z.string().optional() });

// POST /api/offices  -  see also /api/superadmin/offices, which is the richer surface.
// Registering an office is a platform-level act, so it needs office.manage_all,
// not the office-local office.manage.
officeRouter.post(
  "/",
  requirePermission("office.manage_all"),
  asyncHandler(async (req, res) => {
    const data = officeSchema.parse(req.body);
    const office = await prisma.office.create({ data, select: officeDirectorySelect });
    res.status(201).json(office);
  })
);

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
