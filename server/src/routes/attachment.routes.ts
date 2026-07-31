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

export const attachmentRouter = Router();
attachmentRouter.use(authenticate);

// Ensure the upload directory exists, then store files with a random name on
// disk while keeping the original name in the database for display/download.
fs.mkdirSync(config.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

// POST /api/tasks/:id/attachments  (multipart form-data, field "file")
attachmentRouter.post(
  "/tasks/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded (field name must be 'file')");
    // Must be able to view the task to attach to it.
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibilityWhere(req.user!)] },
      select: { id: true },
    });
    if (!task) {
      fs.unlink(req.file.path, () => {});
      throw new HttpError(404, "Task not found or not visible to you");
    }
    const attachment = await prisma.attachment.create({
      data: {
        taskId: task.id,
        storagePath: path.basename(req.file.path),
        fileName: req.file.originalname,
        uploadedById: req.user!.id,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
    await prisma.activityLog.create({
      data: { taskId: task.id, actorId: req.user!.id, action: "attachment_added", detail: { file: req.file.originalname } },
    });
    res.status(201).json(attachment);
  })
);

// GET /api/tasks/:id/attachments
attachmentRouter.get(
  "/tasks/:id/attachments",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibilityWhere(req.user!)] },
      select: { id: true },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const files = await prisma.attachment.findMany({
      where: { taskId: task.id },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(files);
  })
);

// GET /api/attachments/:id/download
attachmentRouter.get(
  "/attachments/:id/download",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) throw new HttpError(404, "Attachment not found");
    // Enforce the same visibility as the parent task.
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: att.taskId }, taskVisibilityWhere(req.user!)] },
      select: { id: true },
    });
    if (!task) throw new HttpError(403, "You cannot access this file");

    const filePath = path.join(config.uploadDir, att.storagePath);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "File missing on server");
    res.download(filePath, att.fileName);
  })
);

// DELETE /api/attachments/:id  -  uploader or someone who can edit the task
attachmentRouter.delete(
  "/attachments/:id",
  asyncHandler(async (req, res) => {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) throw new HttpError(404, "Attachment not found");
    const task = await prisma.task.findUnique({ where: { id: att.taskId } });
    const allowed = att.uploadedById === req.user!.id || (task && canEditTask(req.user!, task));
    if (!allowed) throw new HttpError(403, "You cannot delete this file");

    await prisma.attachment.delete({ where: { id: att.id } });
    fs.unlink(path.join(config.uploadDir, att.storagePath), () => {});
    if (task) {
      await prisma.activityLog.create({
        data: { taskId: task.id, actorId: req.user!.id, action: "attachment_removed", detail: { file: att.fileName } },
      });
    }
    res.status(204).end();
  })
);
