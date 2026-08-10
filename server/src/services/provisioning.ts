import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { config } from "../config";
import { HttpError } from "../utils/http";
import { isGlobalAdmin } from "../middleware/auth";
import { sendMail } from "../email/mailer";
import { renderEmail } from "../email/templates";
import type { AuthUser } from "../types/express";

/**
 * Account creation is centralised here because the same three rules must hold
 * whether a Super Admin is minting an Office Admin or an Office Admin is
 * minting a Senior Auditor:
 *
 *   1. Office scope   - you may only create inside an office you control.
 *   2. Anti-escalation - you may never create an account senior to yourself.
 *   3. Domain policy  - the email must sit on the organisation's domain.
 *
 * Nothing else in the app is allowed to call prisma.user.create for a login.
 */

export const accountSelect = {
  id: true,
  employeeId: true,
  fullName: true,
  email: true,
  designation: { select: { id: true, name: true, code: true, rank: true } },
  wing: true,
  mobile: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, level: true } },
  office: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const;

export const createAccountSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email(),
  /** Optional: when omitted a temporary password is generated and returned once. */
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  roleId: z.string().min(1, "A role is required"),
  officeId: z.string().optional(),
  departmentId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  employeeId: z.string().optional(),
  mobile: z.string().optional(),
  designationId: z.string().nullable().optional(),
  wing: z.string().optional(),
  /** Force a password change on first login. Defaults to true. */
  mustChangePassword: z.boolean().optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** A readable temporary password, e.g. "Cag-7f3a91c4". */
export function generateTempPassword(): string {
  return `Cag-${crypto.randomBytes(5).toString("hex")}`;
}

function assertDomain(email: string): void {
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain !== config.allowedEmailDomain.toLowerCase()) {
    throw new HttpError(400, `Accounts must use an @${config.allowedEmailDomain} address`);
  }
}

/**
 * Rule 2. An actor may only grant a role strictly below their own level, so an
 * Office Admin at level 85 can mint a DG at 80 but never a second Super Admin,
 * and never another account at their own level that could then unmake them.
 */
async function assertGrantableRole(actor: AuthUser, roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true, level: true } });
  if (!role) throw new HttpError(404, "Role not found");
  if (!isGlobalAdmin(actor) && role.level >= actor.level) {
    throw new HttpError(403, `You cannot create an account with the "${role.name}" role, which is at or above your own level`);
  }
  return role;
}

/** Rule 1. Resolve which office the new account lands in, and check the actor owns it. */
function resolveOfficeId(actor: AuthUser, requested?: string): string {
  if (isGlobalAdmin(actor)) {
    if (!requested) throw new HttpError(400, "officeId is required");
    return requested;
  }
  if (!actor.officeId) throw new HttpError(403, "Your account is not attached to an office");
  if (requested && requested !== actor.officeId) {
    throw new HttpError(403, "You can only create accounts inside your own office");
  }
  return actor.officeId;
}

export interface CreatedAccount {
  user: Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;
  /** Present only when the server generated the password; show it once, then it is gone. */
  temporaryPassword?: string;
}

export async function createAccount(actor: AuthUser, input: CreateAccountInput) {
  assertDomain(input.email);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new HttpError(409, "An account with this email already exists");

  const officeId = resolveOfficeId(actor, input.officeId);
  const office = await prisma.office.findUnique({ where: { id: officeId }, select: { id: true, isActive: true } });
  if (!office) throw new HttpError(404, "Office not found");
  if (!office.isActive) throw new HttpError(400, "That office is inactive");

  await assertGrantableRole(actor, input.roleId);

  // A department, if given, must belong to the same office.
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId }, select: { officeId: true } });
    if (!dept) throw new HttpError(404, "Department not found");
    if (dept.officeId !== officeId) throw new HttpError(400, "That department belongs to a different office");
  }

  // A reporting manager, if given, must also be in the same office.
  if (input.managerId) {
    const mgr = await prisma.user.findUnique({ where: { id: input.managerId }, select: { officeId: true } });
    if (!mgr) throw new HttpError(404, "Reporting manager not found");
    if (mgr.officeId !== officeId) throw new HttpError(400, "The reporting manager belongs to a different office");
  }

  const temporaryPassword = input.password ? undefined : generateTempPassword();
  const passwordHash = await bcrypt.hash(input.password ?? temporaryPassword!, 12);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      roleId: input.roleId,
      officeId,
      departmentId: input.departmentId ?? undefined,
      managerId: input.managerId ?? undefined,
      employeeId: input.employeeId,
      mobile: input.mobile,
      designationId: input.designationId ?? undefined,
      wing: input.wing,
      mustChangePassword: input.mustChangePassword ?? true,
      createdById: actor.id,
    },
    select: accountSelect,
  });

  // Email the credentials as well as returning them, so the admin does not have
  // to relay them by hand. Best-effort: a mail failure must not undo the account.
  await emailCredentials(user.email, user.fullName, actor.fullName, temporaryPassword ?? null);

  return { user, temporaryPassword };
}

/** Sends the welcome mail with sign-in details. Never throws. */
async function emailCredentials(email: string, fullName: string, createdBy: string, temporaryPassword: string | null) {
  try {
    const { subject, html } = renderEmail({
      title: "Your CAG WMS account is ready",
      body: temporaryPassword
        ? `${createdBy} has created a CAG Work Management System account for you.

Username: ${email}
Temporary password: ${temporaryPassword}

You will be asked to choose your own password the first time you sign in.`
        : `${createdBy} has created a CAG Work Management System account for you. Your username is ${email}. The password was set by your administrator.`,
      name: fullName,
      ctaUrl: config.clientOrigin,
      ctaLabel: "Sign in",
    });
    await sendMail(email, subject, html);
  } catch (e) {
    console.error("[provisioning] credential email failed:", (e as Error).message);
  }
}

/** Reset someone's password to a fresh temporary one and force a change at next login. */
export async function resetPassword(actor: AuthUser, targetId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, officeId: true, role: { select: { level: true } } },
  });
  if (!target) throw new HttpError(404, "User not found");
  if (!isGlobalAdmin(actor)) {
    if (target.officeId !== actor.officeId) throw new HttpError(403, "That account belongs to a different office");
    if ((target.role?.level ?? 0) >= actor.level) throw new HttpError(403, "You cannot reset the password of someone at or above your own level");
  }

  const temporaryPassword = generateTempPassword();
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true },
    select: { email: true, fullName: true },
  });
  await emailCredentials(updated.email, updated.fullName, actor.fullName, temporaryPassword);
  return { temporaryPassword };
}
