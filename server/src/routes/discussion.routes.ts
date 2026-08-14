import { Router } from "express";
import { z } from "zod";
import { CommentKind, Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { taskVisibilityWhere, canEditTask } from "../services/taskAccess";
import { canManageProject, loadVisibleProject } from "../services/projectAccess";
import {
  assertCanReportProgress,
  authorRoleFor,
  canEditOwnPost,
  canReportProgress,
  canRetractPost,
  kindLabel,
  linkAttachmentsToComment,
  projectWatchers,
  taskWatchers,
} from "../services/discussion";
import { notify } from "../services/notify";
import { broadcast } from "../realtime";

/**
 * Discussion: the thread on a work item and the thread on a project.
 *
 * The rule the whole feature turns on: if you can see the item, you can talk
 * about it. Nothing here asks for a special permission to post a remark, reply
 * or attach a file, because a work management system where only the lead may
 * write is a filing cabinet. Reporting progress is the one narrower action, and
 * it is narrower only by a little: leads, whoever holds the item, and anyone on
 * its project.
 */
export const discussionRouter = Router();
discussionRouter.use(authenticate);

const postInclude = {
  author: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      designation: { select: { id: true, name: true, code: true } },
    },
  },
  attachments: {
    select: { id: true, fileName: true, size: true, mimeType: true, createdAt: true },
  },
} as const;

const createSchema = z.object({
  body: z.string().trim().min(1, "Write something first").max(20000),
  kind: z.nativeEnum(CommentKind).optional(),
  parentId: z.string().optional(),
  authorRole: z.string().max(120).optional(),
  /** Files uploaded moments earlier, now being pinned to this post. */
  attachmentIds: z.array(z.string()).max(20).optional(),
  /** Only meaningful on a STATUS_UPDATE. */
  status: z.nativeEnum(TaskStatus).optional(),
  pctComplete: z.number().int().min(0).max(100).optional(),
  /** Ask for this post to sit at the top of the thread. */
  pin: z.boolean().optional(),
});

const editSchema = z.object({ body: z.string().trim().min(1).max(20000) });

/** A blocker is pinned by default: an unpinned blocker is just a complaint. */
function shouldPin(kind: CommentKind, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return kind === CommentKind.BLOCKER || kind === CommentKind.DIRECTION;
}

/** Loads a work item this user may read, or 404s. */
async function loadVisibleTask(req: import("express").Request, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { AND: [{ id: taskId }, taskVisibilityWhere(req.user!)] },
    select: {
      id: true,
      title: true,
      status: true,
      pctComplete: true,
      projectId: true,
      createdById: true,
      primaryLeadId: true,
      secondaryLeadId: true,
      currentlyWithId: true,
      owningOfficeId: true,
      executingOfficeId: true,
      archivedAt: true,
    },
  });
  if (!task) throw new HttpError(404, "Work item not found or not visible to you");
  return task;
}

// ===========================================================================
// WORK ITEM THREAD
// ===========================================================================

// GET /api/tasks/:id/discussion
discussionRouter.get(
  "/tasks/:id/discussion",
  asyncHandler(async (req, res) => {
    const task = await loadVisibleTask(req, req.params.id);
    const kind = req.query.kind as CommentKind | undefined;

    const posts = await prisma.taskComment.findMany({
      where: {
        taskId: task.id,
        ...(kind && kind in CommentKind ? { kind } : {}),
      },
      include: postInclude,
      orderBy: [{ createdAt: "asc" }],
    });

    res.json({
      canPost: true,
      canReportProgress: await canReportProgress(req.user!, task),
      pinned: posts.filter((p) => p.isPinned && !p.deletedAt),
      posts: posts.map((p) => (p.deletedAt ? { ...p, body: "", attachments: [] } : p)),
    });
  })
);

// POST /api/tasks/:id/discussion  -  and its backwards-compatible alias below
async function createTaskPost(req: import("express").Request, res: import("express").Response) {
  const user = req.user!;
  const task = await loadVisibleTask(req, req.params.id);
  if (task.archivedAt) throw new HttpError(400, "This work item was deleted. Restore it before posting.");

  const data = createSchema.parse(req.body);
  const kind = data.kind ?? CommentKind.REMARK;
  const wantsProgress = kind === CommentKind.STATUS_UPDATE || data.status !== undefined || data.pctComplete !== undefined;

  if (wantsProgress) await assertCanReportProgress(user, task);

  // A reply must belong to the thread it claims to reply to.
  if (data.parentId) {
    const parent = await prisma.taskComment.findFirst({
      where: { id: data.parentId, taskId: task.id },
      select: { id: true },
    });
    if (!parent) throw new HttpError(400, "The post you are replying to is not on this work item");
  }

  const statusTo = data.status ?? undefined;
  const pctTo =
    data.pctComplete ?? (statusTo === TaskStatus.FINISHED ? 100 : undefined);

  const meta =
    wantsProgress && (statusTo !== undefined || pctTo !== undefined)
      ? {
          statusFrom: task.status,
          statusTo: statusTo ?? task.status,
          pctFrom: task.pctComplete ?? 0,
          pctTo: pctTo ?? task.pctComplete ?? 0,
        }
      : undefined;

  const post = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorId: user.id,
      authorRole: await authorRoleFor(user, data.authorRole),
      kind,
      body: data.body,
      parentId: data.parentId,
      isPinned: shouldPin(kind, data.pin),
      meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
    },
    include: postInclude,
  });

  if (data.attachmentIds?.length) {
    await linkAttachmentsToComment(data.attachmentIds, user.id, { taskId: task.id }, { taskCommentId: post.id });
  }

  // Apply the reported movement to the work item itself, so the thread and the
  // item can never tell two different stories.
  if (wantsProgress) {
    // platform-scope: `task` came from loadVisibleTask, which filters by
    // taskVisibilityWhere, and assertCanReportProgress has already run. The
    // office boundary was enforced before we got here.
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: statusTo,
        pctComplete: pctTo,
        lastUpdateAt: new Date(),
      },
    });
    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        actorId: user.id,
        action: "progress_reported",
        detail: {
          statusFrom: task.status,
          statusTo: statusTo ?? task.status,
          pctFrom: task.pctComplete ?? 0,
          pctTo: pctTo ?? task.pctComplete ?? 0,
          note: data.body.slice(0, 300),
        },
      },
    });
  } else {
    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        actorId: user.id,
        action: kind === CommentKind.BLOCKER ? "blocker_raised" : "commented",
        detail: { kind, excerpt: data.body.slice(0, 200) },
      },
    });
  }

  // Tell the room. A reply also pings the person being replied to, even if they
  // would otherwise not be on the watcher list.
  const watchers = await taskWatchers(task.id, user.id);
  if (data.parentId) {
    const parent = await prisma.taskComment.findUnique({
      where: { id: data.parentId },
      select: { authorId: true },
    });
    if (parent?.authorId && parent.authorId !== user.id && !watchers.includes(parent.authorId)) {
      watchers.push(parent.authorId);
    }
  }

  const subject = `${kindLabel(kind)} on ${task.title}`;
  for (const uid of watchers) {
    await notify({
      userId: uid,
      kind: kind === CommentKind.STATUS_UPDATE ? "status_update" : kind === CommentKind.BLOCKER ? "blocker" : "comment",
      title: subject,
      body: `${user.fullName}: ${data.body.slice(0, 240)}`,
      taskId: task.id,
    });
  }

  broadcast("discussion:changed", { scope: "task", id: task.id });
  broadcast("task:changed", { taskId: task.id });
  res.status(201).json(post);
}

discussionRouter.post("/tasks/:id/discussion", asyncHandler(createTaskPost));
// The original endpoint, kept so nothing that already calls it breaks.
discussionRouter.post("/tasks/:id/comments", asyncHandler(createTaskPost));

/**
 * POST /api/tasks/:id/progress  -  report progress without writing an essay.
 * A note is still required: a status that moved for no stated reason is the
 * thing every review meeting then spends ten minutes reconstructing.
 */
discussionRouter.post(
  "/tasks/:id/progress",
  asyncHandler(async (req, res) => {
    req.body = { ...req.body, kind: CommentKind.STATUS_UPDATE };
    await createTaskPost(req, res);
  })
);

// PATCH /api/discussion/task/:postId  -  edit your own words
discussionRouter.patch(
  "/discussion/task/:postId",
  asyncHandler(async (req, res) => {
    const post = await prisma.taskComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, taskId: true, authorId: true, deletedAt: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    if (post.deletedAt) throw new HttpError(400, "That post was withdrawn");
    await loadVisibleTask(req, post.taskId);
    if (!canEditOwnPost(req.user!, post)) throw new HttpError(403, "You can only edit your own posts");

    const { body } = editSchema.parse(req.body);
    const updated = await prisma.taskComment.update({
      where: { id: post.id },
      data: { body, editedAt: new Date() },
      include: postInclude,
    });
    broadcast("discussion:changed", { scope: "task", id: post.taskId });
    res.json(updated);
  })
);

// DELETE /api/discussion/task/:postId  -  withdraw a post (tombstone, not erase)
discussionRouter.delete(
  "/discussion/task/:postId",
  asyncHandler(async (req, res) => {
    const post = await prisma.taskComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, taskId: true, authorId: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    const task = await loadVisibleTask(req, post.taskId);
    const manages = canEditTask(req.user!, {
      createdById: task.createdById,
      primaryLeadId: task.primaryLeadId,
      secondaryLeadId: task.secondaryLeadId,
      currentlyWithId: task.currentlyWithId,
      owningOfficeId: task.owningOfficeId,
      executingOfficeId: task.executingOfficeId,
    });
    if (!canRetractPost(req.user!, post, manages)) throw new HttpError(403, "You cannot withdraw this post");

    await prisma.taskComment.update({
      where: { id: post.id },
      data: { deletedAt: new Date(), isPinned: false },
    });
    broadcast("discussion:changed", { scope: "task", id: post.taskId });
    res.status(204).end();
  })
);

// POST /api/discussion/task/:postId/pin  -  pin or unpin ({ pinned: boolean })
discussionRouter.post(
  "/discussion/task/:postId/pin",
  asyncHandler(async (req, res) => {
    const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
    const post = await prisma.taskComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, taskId: true, kind: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    const task = await loadVisibleTask(req, post.taskId);
    await assertCanReportProgress(req.user!, task);

    const updated = await prisma.taskComment.update({
      where: { id: post.id },
      data: { isPinned: pinned },
      include: postInclude,
    });
    if (post.kind === CommentKind.BLOCKER && !pinned) {
      await prisma.activityLog.create({
        data: { taskId: post.taskId, actorId: req.user!.id, action: "blocker_cleared" },
      });
    }
    broadcast("discussion:changed", { scope: "task", id: post.taskId });
    broadcast("task:changed", { taskId: post.taskId });
    res.json(updated);
  })
);

// ===========================================================================
// PROJECT THREAD
// ===========================================================================

// GET /api/projects/:id/discussion
discussionRouter.get(
  "/projects/:id/discussion",
  asyncHandler(async (req, res) => {
    const project = await loadVisibleProject(req.user!, req.params.id);
    const posts = await prisma.projectComment.findMany({
      where: { projectId: project.id },
      include: postInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json({
      canPost: true,
      canReportProgress: canManageProject(req.user!, project) || project.members.some((m) => m.userId === req.user!.id),
      pinned: posts.filter((p) => p.isPinned && !p.deletedAt),
      posts: posts.map((p) => (p.deletedAt ? { ...p, body: "", attachments: [] } : p)),
    });
  })
);

// POST /api/projects/:id/discussion
discussionRouter.post(
  "/projects/:id/discussion",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const project = await loadVisibleProject(user, req.params.id);
    if (project.archivedAt) throw new HttpError(400, "This project is archived. Restore it before posting.");

    const data = createSchema.parse(req.body);
    const kind = data.kind ?? CommentKind.REMARK;

    if (data.parentId) {
      const parent = await prisma.projectComment.findFirst({
        where: { id: data.parentId, projectId: project.id },
        select: { id: true },
      });
      if (!parent) throw new HttpError(400, "The post you are replying to is not on this project");
    }

    const post = await prisma.projectComment.create({
      data: {
        projectId: project.id,
        authorId: user.id,
        authorRole: await authorRoleFor(user, data.authorRole),
        kind,
        body: data.body,
        parentId: data.parentId,
        isPinned: shouldPin(kind, data.pin),
      },
      include: postInclude,
    });

    if (data.attachmentIds?.length) {
      await linkAttachmentsToComment(
        data.attachmentIds,
        user.id,
        { projectId: project.id },
        { projectCommentId: post.id }
      );
    }

    // A project-level status update refreshes the project's own freshness clock.
    if (kind === CommentKind.STATUS_UPDATE) {
      // platform-scope: `project` came from loadVisibleProject, which applies
      // projectVisibilityWhere. Only the timestamp is being touched.
      await prisma.project.update({ where: { id: project.id }, data: { lastUpdateAt: new Date() } });
    }

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: user.id,
        action:
          kind === CommentKind.STATUS_UPDATE
            ? "project_progress_reported"
            : kind === CommentKind.BLOCKER
              ? "blocker_raised"
              : "commented",
        detail: { kind, excerpt: data.body.slice(0, 200) },
      },
    });

    const watchers = await projectWatchers(project.id, user.id);
    if (data.parentId) {
      const parent = await prisma.projectComment.findUnique({
        where: { id: data.parentId },
        select: { authorId: true },
      });
      if (parent?.authorId && parent.authorId !== user.id && !watchers.includes(parent.authorId)) {
        watchers.push(parent.authorId);
      }
    }

    for (const uid of watchers) {
      await notify({
        userId: uid,
        kind: kind === CommentKind.STATUS_UPDATE ? "status_update" : kind === CommentKind.BLOCKER ? "blocker" : "comment",
        title: `${kindLabel(kind)} on ${project.name}`,
        body: `${user.fullName}: ${data.body.slice(0, 240)}`,
        projectId: project.id,
      });
    }

    broadcast("discussion:changed", { scope: "project", id: project.id });
    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(post);
  })
);

// PATCH /api/discussion/project/:postId
discussionRouter.patch(
  "/discussion/project/:postId",
  asyncHandler(async (req, res) => {
    const post = await prisma.projectComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, projectId: true, authorId: true, deletedAt: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    if (post.deletedAt) throw new HttpError(400, "That post was withdrawn");
    await loadVisibleProject(req.user!, post.projectId);
    if (!canEditOwnPost(req.user!, post)) throw new HttpError(403, "You can only edit your own posts");

    const { body } = editSchema.parse(req.body);
    const updated = await prisma.projectComment.update({
      where: { id: post.id },
      data: { body, editedAt: new Date() },
      include: postInclude,
    });
    broadcast("discussion:changed", { scope: "project", id: post.projectId });
    res.json(updated);
  })
);

// DELETE /api/discussion/project/:postId
discussionRouter.delete(
  "/discussion/project/:postId",
  asyncHandler(async (req, res) => {
    const post = await prisma.projectComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, projectId: true, authorId: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    const project = await loadVisibleProject(req.user!, post.projectId);
    if (!canRetractPost(req.user!, post, canManageProject(req.user!, project))) {
      throw new HttpError(403, "You cannot withdraw this post");
    }
    await prisma.projectComment.update({
      where: { id: post.id },
      data: { deletedAt: new Date(), isPinned: false },
    });
    broadcast("discussion:changed", { scope: "project", id: post.projectId });
    res.status(204).end();
  })
);

// POST /api/discussion/project/:postId/pin
discussionRouter.post(
  "/discussion/project/:postId/pin",
  asyncHandler(async (req, res) => {
    const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
    const post = await prisma.projectComment.findUnique({
      where: { id: req.params.postId },
      select: { id: true, projectId: true },
    });
    if (!post) throw new HttpError(404, "Post not found");
    const project = await loadVisibleProject(req.user!, post.projectId);
    if (!canManageProject(req.user!, project)) throw new HttpError(403, "Only a project lead can pin posts");

    const updated = await prisma.projectComment.update({
      where: { id: post.id },
      data: { isPinned: pinned },
      include: postInclude,
    });
    broadcast("discussion:changed", { scope: "project", id: post.projectId });
    res.json(updated);
  })
);
