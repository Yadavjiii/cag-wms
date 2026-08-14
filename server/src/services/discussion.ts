import { CommentKind, ProjectRole } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../utils/http";
import { canEditTask } from "./taskAccess";
import { canContributeToProject } from "./projectAccess";
import type { AuthUser } from "../types/express";

/**
 * The rules of the thread.
 *
 * Reading is governed by whether you can see the parent item, which the route
 * has already established by the time anything here is called. This module
 * answers the two questions that follow: may this person post, and who needs to
 * be told when they do.
 */

/** The shape of a work item this module needs. Kept minimal on purpose. */
export interface TaskShape {
  id: string;
  projectId: string | null;
  createdById: string | null;
  primaryLeadId: string | null;
  secondaryLeadId: string | null;
  currentlyWithId: string | null;
  owningOfficeId: string | null;
  executingOfficeId: string | null;
}

/**
 * May this user report progress on this work item: move its status, move its
 * percentage, post a STATUS_UPDATE?
 *
 * Anyone who can edit the item obviously can. Beyond that, anyone on the
 * project the item belongs to can, apart from observers. That is the point of
 * putting work in a project: the people doing it can say where it is without
 * first being made a lead.
 */
export async function canReportProgress(user: AuthUser, task: TaskShape): Promise<boolean> {
  if (canEditTask(user, task)) return true;
  if (user.permissions.includes("task.update_progress")) return true;
  if (!task.projectId) return false;
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: task.projectId, userId: user.id } },
    select: { role: true },
  });
  return !!membership && membership.role !== ProjectRole.OBSERVER;
}

/** Same question, but it throws the explanation the user needs to see. */
export async function assertCanReportProgress(user: AuthUser, task: TaskShape): Promise<void> {
  if (await canReportProgress(user, task)) return;
  throw new HttpError(
    403,
    "You can read this work item but not report on it. Ask a lead to add you to the project, or to the item itself."
  );
}

/**
 * Everyone who should hear about a new post on a work item: its leads, whoever
 * is holding it, whoever raised it, everyone on its project, and everyone who
 * has already spoken on the thread. Silence is the failure mode that matters
 * here, so this list is deliberately generous, and de-duplicated.
 */
export async function taskWatchers(taskId: string, exceptUserId?: string): Promise<string[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      createdById: true,
      primaryLeadId: true,
      secondaryLeadId: true,
      currentlyWithId: true,
    },
  });
  if (!task) return [];

  const ids = new Set<string>();
  for (const id of [task.createdById, task.primaryLeadId, task.secondaryLeadId, task.currentlyWithId]) {
    if (id) ids.add(id);
  }

  if (task.projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: task.projectId },
      select: { userId: true },
    });
    members.forEach((m) => ids.add(m.userId));
  }

  const speakers = await prisma.taskComment.findMany({
    where: { taskId, deletedAt: null, authorId: { not: null } },
    select: { authorId: true },
    distinct: ["authorId"],
    take: 100,
  });
  speakers.forEach((s) => s.authorId && ids.add(s.authorId));

  if (exceptUserId) ids.delete(exceptUserId);
  return [...ids];
}

/** The same, for a project thread. */
export async function projectWatchers(projectId: string, exceptUserId?: string): Promise<string[]> {
  const ids = new Set<string>();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { createdById: true, members: { select: { userId: true } } },
  });
  if (!project) return [];
  if (project.createdById) ids.add(project.createdById);
  project.members.forEach((m) => ids.add(m.userId));

  const speakers = await prisma.projectComment.findMany({
    where: { projectId, deletedAt: null, authorId: { not: null } },
    select: { authorId: true },
    distinct: ["authorId"],
    take: 100,
  });
  speakers.forEach((s) => s.authorId && ids.add(s.authorId));

  if (exceptUserId) ids.delete(exceptUserId);
  return [...ids];
}

/**
 * Attaches already-uploaded files to a post.
 *
 * The client uploads first and posts second, so the ids arrive after the file
 * is on disk. Only the uploader's own files, only files sitting against this
 * same parent, and only files not already claimed by another post: without
 * those three checks an id in a request body would be enough to pull somebody
 * else's document onto your comment.
 */
export async function linkAttachmentsToComment(
  attachmentIds: string[],
  uploaderId: string,
  target: { taskId?: string; projectId?: string },
  comment: { taskCommentId?: string; projectCommentId?: string }
): Promise<number> {
  const ids = [...new Set(attachmentIds.filter(Boolean))];
  if (!ids.length) return 0;

  const result = await prisma.attachment.updateMany({
    where: {
      id: { in: ids },
      uploadedById: uploaderId,
      taskCommentId: null,
      projectCommentId: null,
      ...(target.taskId ? { taskId: target.taskId } : {}),
      ...(target.projectId ? { projectId: target.projectId } : {}),
    },
    data: {
      taskCommentId: comment.taskCommentId ?? undefined,
      projectCommentId: comment.projectCommentId ?? undefined,
    },
  });
  return result.count;
}

/** How a post reads in a notification subject line. */
export function kindLabel(kind: CommentKind): string {
  switch (kind) {
    case CommentKind.STATUS_UPDATE:
      return "Progress update";
    case CommentKind.DIRECTION:
      return "Direction";
    case CommentKind.DECISION:
      return "Decision";
    case CommentKind.BLOCKER:
      return "Blocker raised";
    default:
      return "New remark";
  }
}

/** A post carries authority, so record the post the author held when writing. */
export async function authorRoleFor(user: AuthUser, explicit?: string): Promise<string | undefined> {
  if (explicit?.trim()) return explicit.trim();
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { designation: { select: { name: true } }, role: { select: { name: true } } },
  });
  return me?.designation?.name ?? me?.role?.name ?? undefined;
}

/** Only the author may edit their own words; a manager may retract a post. */
export function canEditOwnPost(user: AuthUser, post: { authorId: string | null }): boolean {
  return post.authorId === user.id;
}

/** Retraction: the author, or someone who runs the item, tombstones a post. */
export function canRetractPost(user: AuthUser, post: { authorId: string | null }, manages: boolean): boolean {
  return canEditOwnPost(user, post) || manages;
}

/** True when the discussion contains an unresolved blocker. */
export async function taskHasOpenBlocker(taskId: string): Promise<boolean> {
  const blocker = await prisma.taskComment.findFirst({
    where: { taskId, kind: CommentKind.BLOCKER, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, isPinned: true },
  });
  return !!blocker?.isPinned;
}

/** Re-export so routes need one import for the whole discussion surface. */
export { canContributeToProject };
