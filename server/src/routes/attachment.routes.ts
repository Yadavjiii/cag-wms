import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { prisma } from "../prisma";
import { config } from "../config";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { taskVisibilityWhere, canEditTask } from "../services/taskAccess";
import { canManageProject, canContributeToProject, loadVisibleProject } from "../services/projectAccess";
import { broadcast } from "../realtime";

/**
 * Files.
 *
 * One table and one upload path, because the alternative, a separate route for
 * work items, projects and posts, is three chances to get the permission check
 * wrong. The rule is the same everywhere: you may attach a file to anything you
 * can contribute to, and you may download a file if you can see whatever it
 * hangs off.
 */
export const attachmentRouter = Router();
attachmentRouter.use(authenticate);

fs.mkdirSync(config.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});

const MAX_MB = 25;
const upload = multer({ storage, limits: { fileSize: MAX_MB * 1024 * 1024 } });

/**
 * Executables and scripts are refused. Everything else is allowed: this is a
 * work management system, not a curated library, and a whitelist of office
 * formats only results in people mailing the file round instead.
 */
const BLOCKED_EXT = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".vbs", ".js",
  ".jar", ".sh", ".apk", ".hta", ".cpl", ".jse", ".wsf", ".lnk",
]);

function assertAllowed(file: Express.Multer.File): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXT.has(ext)) {
    fs.unlink(file.path, () => {});
    throw new HttpError(400, `${ext} files cannot be uploaded. Put it in an archive if it is genuinely needed.`);
  }
}

const fileSelect = {
  id: true,
  fileName: true,
  size: true,
  mimeType: true,
  createdAt: true,
  taskId: true,
  projectId: true,
  taskCommentId: true,
  projectCommentId: true,
  uploadedBy: { select: { id: true, fullName: true } },
} as const;

// ===========================================================================
// WORK ITEM FILES
// ===========================================================================

// POST /api/tasks/:id/attachments   (multipart form-data, field "file")
attachmentRouter.post(
  "/tasks/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded (field name must be 'file')");
    assertAllowed(req.file);

    // Being able to see the work item is enough to attach to it: anyone who can
    // read the thread can hand over the document the thread is about.
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibilityWhere(req.user!)] },
      select: { id: true, projectId: true, archivedAt: true },
    });
    if (!task || task.archivedAt) {
      fs.unlink(req.file.path, () => {});
      throw new HttpError(404, "Work item not found or not visible to you");
    }

    const attachment = await prisma.attachment.create({
      data: {
        taskId: task.id,
        storagePath: path.basename(req.file.path),
        fileName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        uploadedById: req.user!.id,
      },
      select: fileSelect,
    });

    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        actorId: req.user!.id,
        action: "attachment_added",
        detail: { file: req.file.originalname, size: req.file.size },
      },
    });

    broadcast("task:changed", { taskId: task.id });
    res.status(201).json(attachment);
  })
);

// GET /api/tasks/:id/attachments   (?all=true to include per-post files)
attachmentRouter.get(
  "/tasks/:id/attachments",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibilityWhere(req.user!)] },
      select: { id: true },
    });
    if (!task) throw new HttpError(404, "Work item not found or not visible to you");

    const files = await prisma.attachment.findMany({
      where: { taskId: task.id, ...(req.query.all === "true" ? {} : { taskCommentId: null }) },
      select: fileSelect,
      orderBy: { createdAt: "desc" },
    });
    res.json(files);
  })
);

// ===========================================================================
// PROJECT FILES
// ===========================================================================

// POST /api/projects/:id/attachments
attachmentRouter.post(
  "/projects/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded (field name must be 'file')");
    assertAllowed(req.file);

    let project: Awaited<ReturnType<typeof loadVisibleProject>>;
    try {
      project = await loadVisibleProject(req.user!, req.params.id);
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      throw e;
    }
    if (!canContributeToProject(req.user!, project) || project.archivedAt) {
      fs.unlink(req.file.path, () => {});
      throw new HttpError(403, "You cannot add files to this project");
    }

    const attachment = await prisma.attachment.create({
      data: {
        projectId: project.id,
        storagePath: path.basename(req.file.path),
        fileName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        uploadedById: req.user!.id,
      },
      select: fileSelect,
    });

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: "attachment_added",
        detail: { file: req.file.originalname, size: req.file.size },
      },
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(attachment);
  })
);

// GET /api/projects/:id/attachments
//
// The project's own files by default; with ?all=true, every file from every work
// item under it too, which is what people mean by "find me the document from
// that audit".
attachmentRouter.get(
  "/projects/:id/attachments",
  asyncHandler(async (req, res) => {
    const project = await loadVisibleProject(req.user!, req.params.id);
    const everything = req.query.all === "true";
    const files = await prisma.attachment.findMany({
      where: everything
        ? { OR: [{ projectId: project.id }, { task: { projectId: project.id } }] }
        : { projectId: project.id, projectCommentId: null },
      select: { ...fileSelect, task: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    res.json(files);
  })
);

// ===========================================================================
// DOWNLOAD, PREVIEW, REMOVE
// ===========================================================================

/** Throws unless the user can see whatever this file hangs off. */
async function assertCanReach(
  req: import("express").Request,
  att: { taskId: string | null; projectId: string | null; taskCommentId: string | null; projectCommentId: string | null }
): Promise<void> {
  // A file on a post inherits its parent's visibility, so resolve that first.
  let taskId = att.taskId;
  let projectId = att.projectId;

  if (!taskId && att.taskCommentId) {
    const post = await prisma.taskComment.findUnique({ where: { id: att.taskCommentId }, select: { taskId: true } });
    taskId = post?.taskId ?? null;
  }
  if (!projectId && att.projectCommentId) {
    const post = await prisma.projectComment.findUnique({
      where: { id: att.projectCommentId },
      select: { projectId: true },
    });
    projectId = post?.projectId ?? null;
  }

  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: taskId }, taskVisibilityWhere(req.user!)] },
      select: { id: true },
    });
    if (task) return;
  }
  if (projectId) {
    await loadVisibleProject(req.user!, projectId); // throws when not visible
    return;
  }
  throw new HttpError(403, "You cannot access this file");
}

// GET /api/attachments/:id/download
attachmentRouter.get(
  "/attachments/:id/download",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) throw new HttpError(404, "Attachment not found");
    await assertCanReach(req, att);

    const filePath = path.join(config.uploadDir, att.storagePath);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "File missing on server");
    res.download(filePath, att.fileName);
  })
);

// GET /api/attachments/:id/view  -  inline preview for images, PDFs and text
attachmentRouter.get(
  "/attachments/:id/view",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) throw new HttpError(404, "Attachment not found");
    await assertCanReach(req, att);

    if (!/^(image\/|application\/pdf|text\/plain)/.test(att.mimeType ?? "")) {
      throw new HttpError(400, "That file type cannot be previewed. Download it instead.");
    }

    const filePath = path.join(config.uploadDir, att.storagePath);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "File missing on server");
    res.setHeader("Content-Type", att.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.fileName)}"`);
    // Never let the browser sniff an uploaded file into something executable.
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(filePath).pipe(res);
  })
);

// DELETE /api/attachments/:id  -  the uploader, or whoever runs the parent
attachmentRouter.delete(
  "/attachments/:id",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) throw new HttpError(404, "Attachment not found");
    await assertCanReach(req, att);

    let allowed = att.uploadedById === req.user!.id;

    if (!allowed && att.taskId) {
      const task = await prisma.task.findUnique({ where: { id: att.taskId } });
      allowed = !!task && canEditTask(req.user!, task);
    }
    if (!allowed && att.projectId) {
      const project = await loadVisibleProject(req.user!, att.projectId);
      allowed = canManageProject(req.user!, project);
    }
    if (!allowed) throw new HttpError(403, "You can only delete files you uploaded");

    await prisma.attachment.delete({ where: { id: att.id } });
    fs.unlink(path.join(config.uploadDir, att.storagePath), () => {});

    await prisma.activityLog.create({
      data: {
        taskId: att.taskId,
        projectId: att.projectId,
        actorId: req.user!.id,
        action: "attachment_removed",
        detail: { file: att.fileName },
      },
    });

    if (att.taskId) broadcast("task:changed", { taskId: att.taskId });
    if (att.projectId) broadcast("project:changed", { projectId: att.projectId });
    res.status(204).end();
  })
);
