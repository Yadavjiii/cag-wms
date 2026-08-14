import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate, isGlobalAdmin } from "../middleware/auth";
import { VISIBLE } from "../services/accountLifecycle";

export const profileRouter = Router();
profileRouter.use(authenticate);

const publicSelect = {
  id: true,
  employeeId: true,
  fullName: true,
  email: true,
  designation: { select: { id: true, name: true, code: true, rank: true } },
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

// Note: officeId is deliberately NOT editable here. Which office you belong to
// is an administrative fact set by an admin, not a self-service preference.
// Allowing it would let anyone walk into another office's data.
const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  designationId: z.string().nullable().optional(),
  wing: z.string().optional(),
  avatarUrl: z.string().url().optional(),
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
    // The directory is office-scoped. You cannot assign work directly to
    // someone in another office anyway; that goes through an inter-office
    // request, so there is no reason to list them here.
    const officeScope = isGlobalAdmin(req.user!) ? {} : { officeId: req.user!.officeId ?? "__none__", isActive: true };
    const users = await prisma.user.findMany({
      where: {
        ...VISIBLE,
        ...officeScope,
        ...(q ? { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { employeeId: { contains: q } }] } : {}),
      },
      select: publicSelect,
      orderBy: { fullName: "asc" },
      take: 200,
    });
    res.json(users);
  })
);
