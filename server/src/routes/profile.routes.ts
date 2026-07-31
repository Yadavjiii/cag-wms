import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate } from "../middleware/auth";

export const profileRouter = Router();
profileRouter.use(authenticate);

const publicSelect = {
  id: true,
  cagId: true,
  fullName: true,
  email: true,
  designation: true,
  wing: true,
  role: { select: { id: true, name: true, level: true } },
  avatarUrl: true,
  officeId: true,
  department: { select: { id: true, name: true } },
  office: { select: { id: true, name: true, code: true } },
} as const;

// GET /api/profiles/me
profileRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicSelect });
    res.json(me);
  })
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  designation: z.string().optional(),
  wing: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  cagId: z.string().optional(),
  officeId: z.string().optional(),
});

// PATCH /api/profiles/me  -  a user may edit only their own profile
profileRouter.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const updated = await prisma.user.update({ where: { id: req.user!.id }, data, select: publicSelect });
    res.json(updated);
  })
);

// GET /api/profiles  -  staff directory (needed to assign work to people)
profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const users = await prisma.user.findMany({
      where: q
        ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { cagId: { contains: q } }] }
        : undefined,
      select: publicSelect,
      orderBy: { fullName: "asc" },
      take: 200,
    });
    res.json(users);
  })
);
