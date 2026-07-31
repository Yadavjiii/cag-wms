import { Prisma } from "@prisma/client";
import type { AuthUser } from "../types/express";

/** The authorization layer (what row-level security did in Postgres):
 *  a Prisma filter describing exactly which tasks this user may read. */
export function taskVisibilityWhere(user: AuthUser): Prisma.TaskWhereInput {
  if (user.permissions.includes("task.view_all")) return {};
  const or: Prisma.TaskWhereInput[] = [
    { createdById: user.id },
    { primaryLeadId: user.id },
    { secondaryLeadId: user.id },
    { currentlyWithId: user.id },
    { team: { members: { some: { userId: user.id } } } },
  ];
  if (user.permissions.includes("task.view_office") && user.officeId) or.push({ officeId: user.officeId });
  return { OR: or };
}

/** Can this user edit this specific task? */
export function canEditTask(
  user: AuthUser,
  task: { createdById: string | null; primaryLeadId: string | null; secondaryLeadId: string | null; currentlyWithId: string | null; officeId: string | null }
): boolean {
  if (user.permissions.includes("task.edit_any")) return true;
  if (user.permissions.includes("task.edit_office") && task.officeId && task.officeId === user.officeId) return true;
  return [task.createdById, task.primaryLeadId, task.secondaryLeadId, task.currentlyWithId].includes(user.id);
}
