import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../utils/http";

/**
 * Which role is "the Office Admin role"?
 *
 * This used to be answered with "the highest-level role holding staff.manage",
 * which is wrong in a way that is easy to miss: Super Admin holds EVERY
 * permission, staff.manage included, and sits above Office Admin. So that query
 * returned Super Admin and every office admin was minted as a platform
 * operator, complete with office.manage_all, which lifts the office boundary.
 *
 * The rule is therefore stated positively AND negatively: the role must grant
 * staff.manage and must NOT grant office.manage_all. Nothing that can see
 * across offices is ever an office role.
 */

/** Grants staff.manage, does not grant office.manage_all. */
export const OFFICE_ADMIN_ROLE_FILTER: Prisma.RoleWhereInput = {
  permissions: { some: { permission: { key: "staff.manage" } } },
  NOT: { permissions: { some: { permission: { key: "office.manage_all" } } } },
};

/**
 * Resolve the role a new Office Admin should get. Prefers the platform template
 * literally named "Office Admin"; falls back to the most senior office-scoped
 * role that fits the filter.
 */
export async function resolveOfficeAdminRoleId(): Promise<string> {
  const byName = await prisma.role.findFirst({
    where: { ...OFFICE_ADMIN_ROLE_FILTER, name: "Office Admin", officeId: null },
    select: { id: true },
  });
  if (byName) return byName.id;

  const byPermission = await prisma.role.findFirst({
    where: OFFICE_ADMIN_ROLE_FILTER,
    orderBy: { level: "desc" },
    select: { id: true },
  });
  if (byPermission) return byPermission.id;

  throw new HttpError(
    500,
    'No role grants "staff.manage" without also granting "office.manage_all". Re-run the seed (npm run seed).'
  );
}

/**
 * Guard for any endpoint that hands out a role inside an office. A role that
 * can see across offices is a platform role and must never be granted this way,
 * whoever is asking.
 */
export async function assertNotPlatformRole(roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true, permissions: { select: { permission: { select: { key: true } } } } },
  });
  if (!role) throw new HttpError(404, "Role not found");
  if (role.permissions.some((p) => p.permission.key === "office.manage_all")) {
    throw new HttpError(
      403,
      `"${role.name}" is a platform role: it can see and act across every office, so it cannot be given to an office account.`
    );
  }
}
