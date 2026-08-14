import { Prisma, ProjectRole } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../utils/http";
import { isGlobalAdmin } from "../middleware/auth";
import type { AuthUser } from "../types/express";

/**
 * Who may see, contribute to, and manage a project. This used to live inside
 * project.routes.ts, which meant the discussion and dashboard endpoints had no
 * way to ask the same question and were at risk of answering it differently.
 * One definition, imported everywhere.
 */

export interface ProjectShape {
  id: string;
  officeId: string;
  createdById: string | null;
  members?: { userId: string; role: ProjectRole }[];
}

/** A Prisma filter for the projects this user is allowed to read. */
export function projectVisibilityWhere(user: AuthUser): Prisma.ProjectWhereInput {
  if (isGlobalAdmin(user)) return {};
  const or: Prisma.ProjectWhereInput[] = [
    { members: { some: { userId: user.id } } },
    { createdById: user.id },
  ];
  if (user.officeId) or.push({ officeId: user.officeId });
  return { OR: or };
}

/** May this user change the project itself: rename, reschedule, add members? */
export function canManageProject(user: AuthUser, project: ProjectShape): boolean {
  if (isGlobalAdmin(user)) return true;
  if (user.headsOfficeIds.includes(project.officeId)) return true;
  if (project.officeId !== user.officeId) return false;
  if (project.createdById === user.id) return true;
  if (user.permissions.includes("project.manage_any") || user.permissions.includes("team.manage_any")) return true;
  const me = project.members?.find((m) => m.userId === user.id);
  return me?.role === ProjectRole.PRIMARY_LEAD || me?.role === ProjectRole.SECONDARY_LEAD;
}

/**
 * May this user contribute: post on the thread, attach a file, report progress?
 *
 * Deliberately wider than canManageProject and narrower than "can see it". An
 * observer is on the project to watch it, so they read the thread but do not
 * post to it; everybody else who is actually on the work does.
 */
export function canContributeToProject(user: AuthUser, project: ProjectShape): boolean {
  if (canManageProject(user, project)) return true;
  const me = project.members?.find((m) => m.userId === user.id);
  if (me) return me.role !== ProjectRole.OBSERVER;
  // Not on the team, but runs the office the project belongs to.
  return user.permissions.includes("task.edit_office") && project.officeId === user.officeId;
}

/** Is this person on the project at all, in any standing? */
export function isProjectMember(user: AuthUser, project: ProjectShape): boolean {
  return !!project.members?.some((m) => m.userId === user.id);
}

/**
 * Loads a project the user is allowed to see, with the membership rows the
 * permission helpers above need. Throws 404 rather than 403 when it is not
 * visible: confirming that a project exists is itself a disclosure.
 */
export async function loadVisibleProject(user: AuthUser, id: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, projectVisibilityWhere(user)] },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!project) throw new HttpError(404, "Project not found or not visible to you");
  return project;
}

/** Loads a visible project and refuses unless the user may contribute to it. */
export async function loadContributableProject(user: AuthUser, id: string) {
  const project = await loadVisibleProject(user, id);
  if (!canContributeToProject(user, project)) {
    throw new HttpError(403, "You are an observer on this project, so you cannot post to it");
  }
  return project;
}
