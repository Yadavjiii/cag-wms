import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { config } from "../config";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, requirePermission } from "../middleware/auth";

export const settingsRouter = Router();

async function getOrCreate() {
  const existing = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  return existing ?? (await prisma.orgSettings.create({ data: { id: "org" } }));
}

// GET /api/settings  -  PUBLIC so the login screen can show branding
settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const s = await getOrCreate();
    res.json({
      name: s.name,
      primaryColor: s.primaryColor,
      accentColor: s.accentColor,
      logoUrl: s.logoPath ? "/api/settings/logo" : null,
    });
  })
);

// GET /api/settings/logo  -  PUBLIC logo image
settingsRouter.get(
  "/logo",
  asyncHandler(async (_req, res) => {
    const s = await getOrCreate();
    if (!s.logoPath) throw new HttpError(404, "No logo set");
    const p = path.join(config.uploadDir, s.logoPath);
    if (!fs.existsSync(p)) throw new HttpError(404, "Logo missing on server");
    res.sendFile(path.resolve(p));
  })
);

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

// PATCH /api/settings  -  requires org.manage
settingsRouter.patch(
  "/",
  authenticate,
  requirePermission("org.manage"),
  asyncHandler(async (req, res) => {
    const data = patchSchema.parse(req.body);
    const s = await prisma.orgSettings.upsert({ where: { id: "org" }, update: data, create: { id: "org", ...data } });
    res.json({ name: s.name, primaryColor: s.primaryColor, accentColor: s.accentColor, logoUrl: s.logoPath ? "/api/settings/logo" : null });
  })
);

// Logo upload (images only, up to 2 MB)
fs.mkdirSync(config.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `logo-${randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// POST /api/settings/logo  -  requires org.manage
settingsRouter.post(
  "/logo",
  authenticate,
  requirePermission("org.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No image uploaded (field 'file', image only)");
    await prisma.orgSettings.upsert({
      where: { id: "org" },
      update: { logoPath: path.basename(req.file.path) },
      create: { id: "org", logoPath: path.basename(req.file.path) },
    });
    res.status(201).json({ ok: true, logoUrl: "/api/settings/logo" });
  })
);
