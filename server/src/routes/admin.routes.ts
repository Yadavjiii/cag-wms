import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission, isGlobalAdmin } from "../middleware/auth";
import { notify } from "../services/notify";

export const adminRouter = Router();
adminRouter.use(authenticate);

// GET /api/admin/roles  -  list roles (for the assignment dropdown)
adminRouter.get(
  "/roles",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    // Roles are office-owned now, so this must be scoped. Holding role.manage
    // says nothing about WHICH office you may manage: an office admin sees the
    // platform templates plus their own office's roles, and nothing else.
    const roles = await prisma.role.findMany({
      where: isGlobalAdmin(req.user!)
        ? {}
        : { OR: [{ officeId: null }, { officeId: req.user!.officeId ?? "__none__" }] },
      orderBy: { level: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        level: true,
        officeId: true,
        templateId: true,
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
    // Office boundary: a Super Admin sees every account, everyone else only
    // their own office. Holding role.manage is not a licence to look sideways
    // into another office's roster.
    const officeScope = isGlobalAdmin(req.user!) ? {} : { officeId: req.user!.officeId ?? "__none__" };
    const users = await prisma.user.findMany({
      where: {
        ...officeScope,
        ...(q ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }] } : {}),
      },
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

    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true, level: true, officeId: true } });
    if (!role) throw new HttpError(404, "Role not found");
    // A role belonging to another office can never be handed out here.
    if (!isGlobalAdmin(req.user!) && role.officeId !== null && role.officeId !== req.user!.officeId) {
      throw new HttpError(403, "That role belongs to a different office");
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, officeId: true, role: { select: { level: true } } },
    });
    if (!target) throw new HttpError(404, "User not found");

    if (!isGlobalAdmin(req.user!)) {
      // Office boundary. Without this an office admin could promote someone in
      // a different office, which defeats the whole point of the boundary.
      if (target.officeId !== req.user!.officeId) {
        throw new HttpError(403, "That account belongs to a different office");
      }
      // Anti-escalation, both directions: you may not grant a role at or above
      // your own level, and you may not re-role someone already at or above you.
      if (role.level >= req.user!.level) {
        throw new HttpError(403, `You cannot assign the "${role.name}" role, which is at or above your own level`);
      }
      if ((target.role?.level ?? 0) >= req.user!.level) {
        throw new HttpError(403, "You cannot change the role of someone at or above your own level");
      }
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

    // Tell them their permissions changed. This is exactly the kind of change
    // people need to hear about without having to notice it themselves.
    await notify({
      userId: updated.id,
      kind: "role_changed",
      title: `Your role is now ${role.name}`,
      body: `${req.user!.fullName} changed your role in CAG WMS to "${role.name}". Your access may have changed as a result.`,
    });

    res.json(updated);
  })
);
