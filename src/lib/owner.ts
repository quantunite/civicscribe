// The single centralized admin check for CivicScribe.
//
// "Admin" in v1 is one shared OWNER_SECRET: the UI carries it as the cs-owner
// HttpOnly cookie, scripts carry it as an Authorization: Bearer header. Both
// are constant-time compared to the configured secret via the shared
// isAuthorized() helper. This is deliberately the ONE place that decides "is
// this request an admin?", so it can later grow from a single secret into real
// accounts/roles without touching every route.
//
// HARD INVARIANT: when OWNER_SECRET is unset, ownerSecret is null and
// isAuthorized(_, null) is always true, so isAdminRequest returns true for
// everyone. The access layer is then a complete no-op and dev + the existing
// test suite run unchanged.

import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";

/** Name of the admin session cookie (UI) — also the value the owner-login route
 *  sets and the logout route clears. */
export const OWNER_COOKIE = "cs-owner";

/**
 * Read a single cookie value out of a raw `Cookie:` header.
 * Returns null when the header is absent or the cookie is not present.
 */
export function readCookie(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Is this request from the admin?
 *
 * Reads the cs-owner cookie OR the Authorization: Bearer header and
 * constant-time compares either against the configured ownerSecret. Returns
 * TRUE for everyone when ownerSecret is null (open/no-op mode).
 *
 * Accepts a credential when EITHER the cookie or the Bearer header matches, so
 * a stale/wrong cookie does not block a correct Bearer token (and vice versa).
 */
export function isAdminRequest(request: Request): boolean {
  const secret = getConfig().ownerSecret;
  // No-op fast path: isAuthorized(_, null) is already true, but short-circuiting
  // here keeps the open-mode contract obvious and skips header parsing.
  if (!secret) return true;

  const cookie = readCookie(request.headers.get("cookie"), OWNER_COOKIE);
  const bearer = request.headers.get("authorization");

  return isAuthorized(cookie, secret) || isAuthorized(bearer, secret);
}

/**
 * Route-handler guard mirroring the edge middleware (defense in depth: even if
 * the matcher misses, the handler still refuses). Returns null when the request
 * may proceed (admin, or open/no-op mode) and a 401 JSON Response otherwise.
 *
 * Usage at the top of a gated handler:
 *   const denied = requireAdmin(request);
 *   if (denied) return denied;
 */
export function requireAdmin(request: Request): Response | null {
  if (isAdminRequest(request)) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
