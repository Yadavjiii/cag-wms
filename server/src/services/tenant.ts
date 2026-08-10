import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "../types/express";
import { HttpError } from "../utils/http";

/**
 * Tenant isolation.
 *
 * We found office-boundary leaks in five separate routes, in code that looked
 * correct, written by someone who knew the rule. That is not carelessness: it
 * is what happens when a security invariant is enforced by remembering to write
 * a check in every handler.
 *
 * This module makes the current office ambient for the whole request, so a
 * handler no longer has to thread it manually, and gives one obvious, greppable
 * way to say "this query is deliberately platform-wide". Anything that queries
 * an office-owned table without either is flagged by `npm run check:tenancy`.
 */

interface TenantContext {
  user: AuthUser;
  /** Set only inside runPlatformScope(). Deliberate, audited, and rare. */
  platformScope: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Runs the rest of the request with this user's tenant context attached. */
export function runWithTenant<T>(user: AuthUser, fn: () => T): T {
  return storage.run({ user, platformScope: false }, fn);
}

/** The current request's user, or undefined outside a request (jobs, seeds). */
export function currentUser(): AuthUser | undefined {
  return storage.getStore()?.user;
}

/**
 * The office every query in this request should be confined to.
 * Throws rather than returning undefined, because a silent undefined here
 * becomes an unfiltered query, which is exactly the bug we are preventing.
 */
export function currentOfficeId(): string {
  const store = storage.getStore();
  if (!store) throw new HttpError(500, "No tenant context. Did this run outside a request?");
  if (store.user.officeId) return store.user.officeId;
  throw new HttpError(403, "Your account is not attached to an office");
}

/** True when the caller may legitimately see across offices. */
export function isPlatformScoped(): boolean {
  const store = storage.getStore();
  if (!store) return false;
  return store.platformScope || store.user.permissions.includes("office.manage_all");
}

/**
 * Marks a block as deliberately crossing the office boundary. Every call site
 * is a decision someone should be able to justify, so keep them few and keep
 * the reason in the `why` argument where it shows up in a grep.
 */
export function runPlatformScope<T>(why: string, fn: () => T): T {
  const store = storage.getStore();
  if (!store) throw new HttpError(500, "No tenant context");
  void why; // documentation for the reader and for `check:tenancy`
  return storage.run({ ...store, platformScope: true }, fn);
}

// ---------------------------------------------------------------------------
// Where-clause helpers. Use these instead of hand-writing `{ officeId: ... }`,
// so the office rule lives in one place and the checker can see it.
// ---------------------------------------------------------------------------

/** `{ officeId }` for the current tenant, or `{}` for a platform-scoped caller. */
export function officeScope(): { officeId?: string } {
  if (isPlatformScoped()) return {};
  return { officeId: currentOfficeId() };
}

/**
 * For work items, which carry two offices. The owning office stays accountable
 * for work it has delegated, so both sides must match or delegated work drops
 * out of the owning office's reports.
 */
export function taskOfficeScope(): Record<string, unknown> {
  if (isPlatformScoped()) return {};
  const officeId = currentOfficeId();
  return { OR: [{ owningOfficeId: officeId }, { executingOfficeId: officeId }] };
}

/**
 * Guard for a record already loaded from the database. Call this immediately
 * after any findUnique on an office-owned table, because findUnique cannot
 * carry an office predicate.
 */
export function assertSameOffice(record: { officeId?: string | null } | null | undefined, what = "record"): void {
  if (!record) throw new HttpError(404, "Not found");
  if (isPlatformScoped()) return;
  if (record.officeId !== currentOfficeId()) {
    throw new HttpError(403, `That ${what} belongs to a different office`);
  }
}
