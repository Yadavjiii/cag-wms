import { prisma } from "../prisma";
import type { AuthUser } from "../types/express";

/**
 * Loads a user together with their role, the permission keys that role grants,
 * and the offices they head. This is the single source of truth for "who is
 * this and what may they do", used both by the auth middleware and by the
 * login/register/me responses so the client always receives the same shape.
 */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      officeId: true,
      departmentId: true,
      roleId: true,
      isActive: true,
      mustChangePassword: true,
      office: { select: { id: true, name: true, code: true } },
      headedOffices: { select: { id: true } },
      headedDepartments: { select: { id: true } },
      role: {
        select: {
          name: true,
          level: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    officeId: u.officeId,
    officeName: u.office?.name ?? null,
    departmentId: u.departmentId,
    roleId: u.roleId,
    roleName: u.role?.name ?? null,
    level: u.role?.level ?? 0,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    headsOfficeIds: u.headedOffices.map((o) => o.id),
    headsDepartmentIds: u.headedDepartments.map((d) => d.id),
    permissions: u.role?.permissions.map((p) => p.permission.key) ?? [],
  };
}
