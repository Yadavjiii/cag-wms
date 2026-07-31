import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";
import { config } from "../config";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { loadAuthUser } from "../utils/authUser";

export const authRouter = Router();

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  cagId: z.string().optional(),
  designation: z.string().optional(),
  wing: z.string().optional(),
  officeId: z.string().optional(),
});

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

// POST /api/auth/register  -  self-service signup, restricted to the CAG domain
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    const domain = data.email.split("@")[1]?.toLowerCase();
    if (domain !== config.allowedEmailDomain.toLowerCase()) {
      throw new HttpError(403, `Sign-up is restricted to @${config.allowedEmailDomain} addresses`);
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new HttpError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(data.password, 12);
    // New sign-ups get the role flagged isDefault (seeded as "Member").
    const defaultRole = await prisma.role.findFirst({ where: { isDefault: true }, select: { id: true } });
    const created = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        passwordHash,
        cagId: data.cagId,
        designation: data.designation,
        wing: data.wing,
        officeId: data.officeId,
        roleId: defaultRole?.id,
      },
      select: { id: true },
    });

    const user = await loadAuthUser(created.id);
    res.status(201).json({ token: signToken(created.id), user });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new HttpError(401, "Invalid email or password");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password");

    res.json({ token: signToken(user.id), user: await loadAuthUser(user.id) });
  })
);

// GET /api/auth/me
authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);
