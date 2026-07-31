import { Router, Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission } from "../middleware/auth";

type ReqUser = NonNullable<Request["user"]>;

// ============================ OFFICES ============================
export const officeRouter = Router();
officeRouter.use(authenticate);

// GET /api/offices  -  everyone signed in can see the org structure
officeRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const offices = await prisma.office.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, city: true, _count: { select: { departments: true, users: true } } },
    });
    res.json(offices);
  })
);

const officeSchema = z.object({ name: z.string().min(2), code: z.string().optional(), city: z.string().optional() });

// POST /api/offices
officeRouter.post(
  "/",
  requirePermission("office.manage"),
  asyncHandler(async (req, res) => {
    const data = officeSchema.parse(req.body);
    const office = await prisma.office.create({ data });
    res.status(201).json(office);
  })
);

// ============================ DEPARTMENTS ============================
export const departmentRouter = Router();
departmentRouter.use(authenticate);

/** Can this user manage this department? Global managers or the department head. */
function canManageDept(user: ReqUser, dept: { headId: string | null }): boolean {
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
    const officeId = req.query.officeId as string | undefined;
    const departments = await prisma.department.findMany({
      where: officeId ? { officeId } : undefined,
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
    const dept = await prisma.department.create({
      data: { ...data, officeId: data.officeId ?? req.user!.officeId ?? undefined },
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
        members: { select: { id: true, fullName: true, designation: true, email: true }, orderBy: { fullName: "asc" } },
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
    const dept = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, headId: true } });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    const data = updateSchema.parse(req.body);
    const updated = await prisma.department.update({ where: { id: dept.id }, data, select: deptSelect });
    res.json(updated);
  })
);

const memberSchema = z.object({ userId: z.string() });

// POST /api/departments/:id/members  -  assign a user to this department
departmentRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, headId: true } });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    const { userId } = memberSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { departmentId: dept.id },
      select: { id: true, fullName: true, designation: true, email: true },
    });
    res.status(201).json(user);
  })
);

// DELETE /api/departments/:id/members/:userId  -  remove a user from the department
departmentRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const dept = await prisma.department.findUnique({ where: { id: req.params.id }, select: { id: true, headId: true } });
    if (!dept) throw new HttpError(404, "Department not found");
    if (!canManageDept(req.user!, dept)) throw new HttpError(403, "You cannot manage this department");
    await prisma.user.updateMany({ where: { id: req.params.userId, departmentId: dept.id }, data: { departmentId: null } });
    res.status(204).end();
  })
);
