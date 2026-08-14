import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "../utils/http";
import { loadAuthUser } from "../utils/authUser";
import type { AuthUser } from "../types/express";
import { runWithTenant } from "../services/tenant";

interface JwtPayload {
  sub: string;
}

/**
 * Verifies the Bearer token, loads the current user with their role and
 * permissions (always fresh), and attaches it to req.user. A deactivated
 * account is rejected here, so an office admin switching a staff member off
 * kills their session on the very next request.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");
    const token = header.slice(7);

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as unknown as JwtPayload;
    } catch {
      throw new HttpError(401, "Invalid or expired token");
    }

    const user = await loadAuthUser(payload.sub);
    if (!user || user.deletedAt) throw new HttpError(401, "User no longer exists");
    if (!user.isActive) throw new HttpError(403, "This account has been deactivated. Contact your office admin.");

    req.user = user;
    // Make the office ambient for the rest of the request, so handlers and
    // helpers can scope queries without threading it through by hand.
    return runWithTenant(user, () => next());
  } catch (err) {
    next(err);
  }
}

/** True if the user holds the given permission key. */
export function can(user: AuthUser | undefined, key: string): boolean {
  return !!user && user.permissions.includes(key);
}

/** True if the user holds ANY of the given permission keys. */
export function canAny(user: AuthUser | undefined, ...keys: string[]): boolean {
  return !!user && keys.some((k) => user.permissions.includes(k));
}

/**
 * Restricts a route to holders of ALL listed permission keys. Use after
 * authenticate. Permissions come from the database, not from hardcoded roles.
 */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Not authenticated"));
    const ok = keys.every((k) => req.user!.permissions.includes(k));
    if (!ok) return next(new HttpError(403, "Insufficient permissions"));
    next();
  };
}

/** Restricts a route to holders of AT LEAST ONE of the listed permission keys. */
export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Not authenticated"));
    if (!canAny(req.user, ...keys)) return next(new HttpError(403, "Insufficient permissions"));
    next();
  };
}

// ---------------------------------------------------------------------------
// Scope helpers. The rule throughout the app: a Super Admin works across every
// office; everyone else is pinned to their own office unless a cross-office
// request has been approved.
// ---------------------------------------------------------------------------

/** Super Admins (and anyone granted office.manage_all) are not office-bound. */
export function isGlobalAdmin(user: AuthUser): boolean {
  return user.permissions.includes("office.manage_all");
}

/** Is this user the head (DG/PAG/DAG) of the given office? */
export function headsOffice(user: AuthUser, officeId: string | null | undefined): boolean {
  return !!officeId && user.headsOfficeIds.includes(officeId);
}

/** May this user act on records belonging to the given office? */
export function inScopeOffice(user: AuthUser, officeId: string | null | undefined): boolean {
  if (isGlobalAdmin(user)) return true;
  return !!officeId && officeId === user.officeId;
}

/**
 * Throws unless the user may act on the given office. Used by every office-admin
 * route so a Delhi office admin can never touch a Hyderabad account.
 */
export function assertOfficeScope(user: AuthUser, officeId: string | null | undefined): void {
  if (!inScopeOffice(user, officeId)) {
    throw new HttpError(403, "That record belongs to a different office");
  }
}
