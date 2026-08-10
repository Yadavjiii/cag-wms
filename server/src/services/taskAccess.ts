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
    // Anyone on the project can see the project's work.
    { project: { members: { some: { userId: user.id } } } },
    // Work this person has been nominated for, or has sent to another office,
    // stays visible to them while the request is in flight.
    { requests: { some: { toId: user.id } } },
    { requests: { some: { fromId: user.id } } },
  ];
  // Heads see everything their offices own OR are executing, regardless of
  // other grants. Both sides matter: the owning office stays accountable for
  // work it has delegated, so delegated work must not vanish from its reports.
  if (user.headsOfficeIds.length) {
    or.push({ owningOfficeId: { in: user.headsOfficeIds } });
    or.push({ executingOfficeId: { in: user.headsOfficeIds } });
  }
  if (user.permissions.includes("task.view_office") && user.officeId) {
    or.push({ owningOfficeId: user.officeId });
    or.push({ executingOfficeId: user.officeId });
  }
  // The reporting line confers sight of your reports' work. Someone with three
  // direct reports is a manager in fact, whatever their role happens to say.
  or.push({ currentlyWith: { managerId: user.id } });
  or.push({ primaryLead: { managerId: user.id } });
  if (user.headsDepartmentIds.length) or.push({ departmentId: { in: user.headsDepartmentIds } });
  return { OR: or };
}

/** Can this user edit this specific task? */
export function canEditTask(
  user: AuthUser,
  task: { createdById: string | null; primaryLeadId: string | null; secondaryLeadId: string | null; currentlyWithId: string | null; owningOfficeId: string | null; executingOfficeId: string | null }
): boolean {
  if (user.permissions.includes("task.edit_any")) return true;
  // An office head has full authority over work their office owns or executes.
  if (task.owningOfficeId && user.headsOfficeIds.includes(task.owningOfficeId)) return true;
  if (task.executingOfficeId && user.headsOfficeIds.includes(task.executingOfficeId)) return true;
  if (user.permissions.includes("task.edit_office") && task.executingOfficeId && task.executingOfficeId === user.officeId) return true;
  return [task.createdById, task.primaryLeadId, task.secondaryLeadId, task.currentlyWithId].includes(user.id);
}
