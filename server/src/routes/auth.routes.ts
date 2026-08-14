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

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  employeeId: z.string().optional(),
  designationId: z.string().nullable().optional(),
  wing: z.string().optional(),
  officeId: z.string().optional(),
});

/**
 * POST /api/auth/register
 *
 * Off by default. In this deployment accounts are provisioned top-down: the
 * Super Admin creates an Office Admin for each CAG office, and that Office
 * Admin creates the logins for their own staff. Set ALLOW_SELF_REGISTRATION=true
 * only if you want the old open sign-up back.
 */
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    if (!config.allowSelfRegistration) {
      throw new HttpError(
        403,
        "Self sign-up is disabled. Your office admin creates your login and gives you the credentials."
      );
    }

    const data = registerSchema.parse(req.body);

    const domain = data.email.split("@")[1]?.toLowerCase();
    if (domain !== config.allowedEmailDomain.toLowerCase()) {
      throw new HttpError(403, `Sign-up is restricted to @${config.allowedEmailDomain} addresses`);
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new HttpError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(data.password, 12);
    const defaultRole = await prisma.role.findFirst({ where: { isDefault: true }, select: { id: true } });
    const created = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        passwordHash,
        employeeId: data.employeeId,
        designationId: data.designationId ?? undefined,
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
    // A deleted account keeps its row so history renders, but it is not a
    // login any more. Same generic message, so nobody can probe for it.
    if (user.deletedAt || !user.passwordHash) throw new HttpError(401, "Invalid email or password");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password");
    if (!user.isActive) throw new HttpError(403, "This account has been deactivated. Contact your office admin.");

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.json({ token: signToken(user.id), user: await loadAuthUser(user.id) });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * POST /api/auth/change-password
 *
 * Accounts created by an admin land with mustChangePassword set, so the first
 * thing a new office admin or staff member does is replace the temporary
 * password they were handed.
 */
authRouter.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
    if (!me) throw new HttpError(404, "User not found");

    const ok = await bcrypt.compare(currentPassword, me.passwordHash);
    if (!ok) throw new HttpError(401, "Your current password is not correct");
    if (currentPassword === newPassword) throw new HttpError(400, "The new password must be different");

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false },
    });

    res.json({ user: await loadAuthUser(req.user!.id) });
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
