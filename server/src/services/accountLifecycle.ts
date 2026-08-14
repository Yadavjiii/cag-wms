import { prisma } from "../prisma";
import { HttpError } from "../utils/http";
import type { AuthUser } from "../types/express";

/**
 * Deleting an account.
 *
 * To anyone using the app, a deleted account is gone: it vanishes from the
 * staff list, from search, from every assignee and member picker, and it can
 * never sign in again. What survives is the row itself, because sixteen other
 * tables point at it. Without the row, a two-year-old audit task would say it
 * was created by nobody, remarks would lose their authors, and the inter-office
 * approval trail would have a hole exactly where the approver was.
 *
 * So: tombstone, not DELETE. Every query that lists people must apply
 * `VISIBLE`, and every query that resolves a single person for display must
 * not, or history stops rendering.
 */

/** Spread into any `where` that lists selectable people. */
export const VISIBLE = { deletedAt: null } as const;

/** True once an account has been deleted. */
export function isDeleted(u: { deletedAt?: Date | null } | null | undefined): boolean {
  return !!u?.deletedAt;
}

/**
 * Tombstone an account. The email is parked out of the way so the address can
 * be issued again later, and the password hash is destroyed so the old
 * credentials cannot work even if the account were ever restored by hand.
 */
export async function deleteAccount(actor: AuthUser, targetId: string) {
  if (actor.id === targetId) throw new HttpError(400, "You cannot delete your own account");

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, fullName: true, deletedAt: true },
  });
  if (!target) throw new HttpError(404, "Account not found");
  if (target.deletedAt) throw new HttpError(400, "That account is already deleted");

  const parked = `deleted+${Date.now()}+${target.email}`.slice(0, 190);

  await prisma.$transaction([
    // Hand back anything that would otherwise point at a person nobody can see.
    prisma.office.updateMany({ where: { headId: target.id }, data: { headId: null } }),
    prisma.department.updateMany({ where: { headId: target.id }, data: { headId: null } }),
    prisma.user.updateMany({ where: { managerId: target.id }, data: { managerId: null } }),
    // Membership of a live project is not history, so it goes.
    prisma.projectMember.deleteMany({ where: { userId: target.id } }),
    prisma.user.update({
      where: { id: target.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        email: parked,
        passwordHash: "",
        mustChangePassword: false,
      },
    }),
  ]);

  return { deleted: true, name: target.fullName };
}
