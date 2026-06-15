// Server-side session helpers for App Router server components and route
// handlers. Reads the cs-session cookie via next/headers and verifies it with
// the edge-safe verifier. Node/server context only (uses next/headers).

import { cookies } from "next/headers";

import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";
import { OWNER_COOKIE } from "@/lib/owner";
import {
  verifySession,
  SESSION_COOKIE,
  type SessionPayload,
} from "@/lib/auth/session";

/** The signed-in user (from cs-session), or null. Null in open mode (no
 *  SESSION_SECRET) since there are no sessions to read. */
export async function currentUser(): Promise<SessionPayload | null> {
  const secret = getConfig().sessionSecret;
  if (!secret) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return verifySession(token, secret);
}

/** Whether the current request has staff (admin/moderator) access, considering
 *  BOTH the per-user cs-session and the OWNER_SECRET break-glass cookie.
 *
 *  Mirrors the middleware no-op invariant: returns true for everyone when
 *  NEITHER secret is configured, so dev (MOCK_MODE) and the test suite render
 *  the full admin UI unchanged. When either is set, access is granted only on a
 *  valid credential. */
export async function isStaff(): Promise<boolean> {
  const config = getConfig();
  if (!config.ownerSecret && !config.sessionSecret) return true; // open mode

  const store = await cookies();

  if (config.ownerSecret) {
    const ownerCookie = store.get(OWNER_COOKIE)?.value ?? null;
    if (isAuthorized(ownerCookie, config.ownerSecret)) return true;
  }
  if (config.sessionSecret) {
    const token = store.get(SESSION_COOKIE)?.value ?? null;
    const payload = await verifySession(token, config.sessionSecret);
    if (payload && (payload.role === "admin" || payload.role === "moderator")) {
      return true;
    }
  }
  return false;
}
