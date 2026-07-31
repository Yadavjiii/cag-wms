import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission } from "../middleware/auth";

export const adminRouter = Router();
adminRouter.use(authenticate);

// GET /api/admin/roles  -  list roles (for the assignment dropdown)
adminRouter.get(
  "/roles",
  requirePermission("role.manage"),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      orderBy: { level: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        level: true,
        isSystem: true,
        isDefault: true,
        _count: { select: { users: true, permissions: true } },
      },
    });
    res.json(roles);
  })
);

// GET /api/admin/users  -  directory with each user's current role
adminRouter.get(
  "/users",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }] } : undefined,
      orderBy: { fullName: "asc" },
      take: 500,
      select: {
        id: true,
        fullName: true,
        email: true,
        designation: true,
        wing: true,
        role: { select: { id: true, name: true, level: true } },
        office: { select: { id: true, name: true } },
      },
    });
    res.json(users);
  })
);

const assignSchema = z.object({ roleId: z.string() });

// PATCH /api/admin/users/:id/role  -  assign a role to a user
adminRouter.patch(
  "/users/:id/role",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const { roleId } = assignSchema.parse(req.body);

    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, level: true } });
    if (!role) throw new HttpError(404, "Role not found");

    // Anti-escalation: you cannot grant a role more senior than your own.
    if (role.level > req.user!.level) {
      throw new HttpError(403, "You cannot assign a role more senior than your own");
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { roleId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: { select: { id: true, name: true, level: true } },
      },
    });
    res.json(updated);
  })
);
