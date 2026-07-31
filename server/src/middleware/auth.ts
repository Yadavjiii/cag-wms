import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "../utils/http";
import { loadAuthUser } from "../utils/authUser";
import type { AuthUser } from "../types/express";

interface JwtPayload {
  sub: string;
}

/**
 * Verifies the Bearer token, loads the current user with their role and
 * permissions (always fresh), and attaches it to req.user.
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
    if (!user) throw new HttpError(401, "User no longer exists");

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** True if the user holds the given permission key. */
export function can(user: AuthUser | undefined, key: string): boolean {
  return !!user && user.permissions.includes(key);
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
