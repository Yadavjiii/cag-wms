import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission, isGlobalAdmin } from "../middleware/auth";

/**
 * Designations and Roles are deliberately managed side by side here, because
 * the whole point of this module is that they are DIFFERENT THINGS:
 *
 *   Designation = the official post someone holds (DG, SAO, AAO).
 *                 Descriptive. `rank` orders people for display and reporting
 *                 and is NEVER consulted by an authorisation check.
 *
 *   Role        = a bundle of permissions. This is what actually grants power.
 *
 * A DG and an SAO can share the "Office Head" role while holding different
 * posts, and two offices can each define a "Reviewer" that means different
 * things. Conflating the two is the bug this module exists to prevent.
 */
export const designationRouter = Router();
designationRouter.use(authenticate);

const designationSelect = {
  id: true,
  name: true,
  code: true,
  rank: true,
  officeId: true,
  isActive: true,
  _count: { select: { users: true } },
} as const;

// GET /api/designations  -  platform-wide list plus my office's own additions
designationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const designations = await prisma.designation.findMany({
      where: {
        isActive: req.query.includeInactive === "true" ? undefined : true,
        OR: [{ officeId: null }, ...(req.user!.officeId ? [{ officeId: req.user!.officeId }] : [])],
      },
      orderBy: [{ rank: "desc" }, { name: "asc" }],
      select: designationSelect,
    });
    res.json(designations);
  })
);

const designationSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  rank: z.number().int().min(0).max(100).optional(),
  /** Only a Super Admin may create a platform-wide designation. */
  platformWide: z.boolean().optional(),
});

// POST /api/designations  -  add a post
designationRouter.post(
  "/",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const data = designationSchema.parse(req.body);
    const platformWide = data.platformWide && isGlobalAdmin(req.user!);
    const officeId = platformWide ? null : req.user!.officeId;
    if (!platformWide && !officeId) throw new HttpError(400, "Your account is not attached to an office");

    const clash = await prisma.designation.findFirst({ where: { officeId, name: data.name } });
    if (clash) throw new HttpError(409, "A designation with that name already exists here");

    const designation = await prisma.designation.create({
      data: { name: data.name, code: data.code, rank: data.rank ?? 0, officeId },
      select: designationSelect,
    });
    res.status(201).json(designation);
  })
);

// PATCH /api/designations/:id
designationRouter.patch(
  "/:id",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.designation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Designation not found");
    // A platform-wide designation belongs to the Super Admin, not to an office.
    if (existing.officeId === null && !isGlobalAdmin(req.user!)) {
      throw new HttpError(403, "That is a platform-wide designation. Ask the Super Admin to change it.");
    }
    if (existing.officeId && existing.officeId !== req.user!.officeId && !isGlobalAdmin(req.user!)) {
      throw new HttpError(403, "That designation belongs to a different office");
    }

    const data = designationSchema.partial().omit({ platformWide: true }).extend({ isActive: z.boolean().optional() }).parse(req.body);
    const updated = await prisma.designation.update({ where: { id: existing.id }, data, select: designationSelect });
    res.json(updated);
  })
);

// DELETE /api/designations/:id  -  deactivate; never orphan the people holding it
designationRouter.delete(
  "/:id",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.designation.findUnique({
      where: { id: req.params.id },
      select: { id: true, officeId: true, _count: { select: { users: true } } },
    });
    if (!existing) throw new HttpError(404, "Designation not found");
    if (existing.officeId === null && !isGlobalAdmin(req.user!)) {
      throw new HttpError(403, "That is a platform-wide designation");
    }
    if (existing.officeId && existing.officeId !== req.user!.officeId && !isGlobalAdmin(req.user!)) {
      throw new HttpError(403, "That designation belongs to a different office");
    }
    if (existing._count.users > 0) {
      // Deactivating keeps it off new forms while leaving existing profiles intact.
      await prisma.designation.update({ where: { id: existing.id }, data: { isActive: false } });
      return res.json({ deactivated: true, reason: `${existing._count.users} people still hold this designation` });
    }
    await prisma.designation.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);

// ===========================================================================
// Roles: office-owned clones of platform templates
// ===========================================================================

export const roleRouter = Router();
roleRouter.use(authenticate);

const roleSelect = {
  id: true,
  name: true,
  description: true,
  level: true,
  officeId: true,
  templateId: true,
  isSystem: true,
  isDefault: true,
  permissions: { select: { permission: { select: { id: true, key: true, description: true } } } },
  _count: { select: { users: true } },
} as const;

// GET /api/roles  -  platform templates plus my office's own roles
roleRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const roles = await prisma.role.findMany({
      where: { OR: [{ officeId: null }, ...(req.user!.officeId ? [{ officeId: req.user!.officeId }] : [])] },
      orderBy: [{ level: "desc" }, { name: "asc" }],
      select: roleSelect,
    });
    res.json(roles);
  })
);

// GET /api/roles/permissions  -  everything this admin is allowed to hand out
roleRouter.get(
  "/permissions",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const all = await prisma.permission.findMany({ orderBy: { key: "asc" } });
    // You may only grant what you hold. This is the rule that actually closes
    // the escalation hole: without it, custom roles are a privilege-escalation
    // feature with extra steps.
    const grantable = isGlobalAdmin(req.user!) ? all : all.filter((p) => req.user!.permissions.includes(p.key));
    res.json(grantable);
  })
);

const cloneSchema = z.object({
  templateId: z.string(),
  name: z.string().min(2).optional(),
});

// POST /api/roles/clone  -  copy a platform template into my office to edit
roleRouter.post(
  "/clone",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const { templateId, name } = cloneSchema.parse(req.body);
    const officeId = req.user!.officeId;
    if (!officeId) throw new HttpError(400, "Your account is not attached to an office");

    const template = await prisma.role.findUnique({
      where: { id: templateId },
      include: { permissions: true },
    });
    if (!template) throw new HttpError(404, "Template not found");
    if (template.officeId !== null) throw new HttpError(400, "That is already an office role, not a template");
    if (!isGlobalAdmin(req.user!) && template.level >= req.user!.level) {
      throw new HttpError(403, `You cannot clone "${template.name}", which sits at or above your own level`);
    }

    const roleName = name ?? template.name;
    const clash = await prisma.role.findFirst({ where: { officeId, name: roleName } });
    if (clash) throw new HttpError(409, "Your office already has a role with that name");

    const role = await prisma.role.create({
      data: {
        name: roleName,
        description: template.description,
        level: template.level,
        officeId,
        templateId: template.id,
        isSystem: false,
        permissions: { create: template.permissions.map((p) => ({ permissionId: p.permissionId })) },
      },
      select: roleSelect,
    });
    res.status(201).json(role);
  })
);

const rolePermsSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  level: z.number().int().min(0).max(100).optional(),
  permissionKeys: z.array(z.string()).optional(),
});

// PATCH /api/roles/:id  -  edit an office role, within the escalation ceiling
roleRouter.patch(
  "/:id",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) throw new HttpError(404, "Role not found");

    if (!isGlobalAdmin(req.user!)) {
      if (role.officeId === null) throw new HttpError(403, "Platform templates are maintained by the Super Admin. Clone it into your office first.");
      if (role.officeId !== req.user!.officeId) throw new HttpError(403, "That role belongs to a different office");
      if (role.level >= req.user!.level) throw new HttpError(403, "You cannot edit a role at or above your own level");
    }

    const data = rolePermsSchema.parse(req.body);
    if (data.level !== undefined && !isGlobalAdmin(req.user!) && data.level >= req.user!.level) {
      throw new HttpError(403, "You cannot raise a role to or above your own level");
    }

    if (data.permissionKeys) {
      // Rule: you may only grant permissions you hold yourself.
      if (!isGlobalAdmin(req.user!)) {
        const overreach = data.permissionKeys.filter((k) => !req.user!.permissions.includes(k));
        if (overreach.length) {
          throw new HttpError(403, `You cannot grant permissions you do not hold: ${overreach.join(", ")}`);
        }
        if (data.permissionKeys.includes("office.manage_all")) {
          throw new HttpError(403, "Platform-scope permissions cannot be granted by an office admin");
        }
      }
      const perms = await prisma.permission.findMany({ where: { key: { in: data.permissionKeys } }, select: { id: true } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }

    const updated = await prisma.role.update({
      where: { id: role.id },
      data: { name: data.name, description: data.description, level: data.level },
      select: roleSelect,
    });
    res.json(updated);
  })
);

// DELETE /api/roles/:id  -  only an unused, non-system office role
roleRouter.delete(
  "/:id",
  requirePermission("role.manage"),
  asyncHandler(async (req, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      select: { id: true, officeId: true, isSystem: true, level: true, _count: { select: { users: true } } },
    });
    if (!role) throw new HttpError(404, "Role not found");
    if (role.isSystem) throw new HttpError(400, "System roles cannot be deleted");
    if (!isGlobalAdmin(req.user!)) {
      if (role.officeId !== req.user!.officeId) throw new HttpError(403, "That role belongs to a different office");
      if (role.level >= req.user!.level) throw new HttpError(403, "You cannot delete a role at or above your own level");
    }
    if (role._count.users > 0) {
      throw new HttpError(400, `${role._count.users} people still hold this role. Move them to another role first.`);
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.role.delete({ where: { id: role.id } });
    res.status(204).end();
  })
);
