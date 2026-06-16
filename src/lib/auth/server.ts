// Server-side session helpers for App Router server components and route
// handlers. Reads the cs-session cookie via next/headers and verifies it with
// the edge-safe verifier. Node/server context only (uses next/headers).

import { cookies } from "next/headers";

import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";
import { OWNER_COOKIE, isStaffRequest } from "@/lib/owner";
import {
  verifySession,
  SESSION_COOKIE,
  type SessionPayload,
} from "@/lib/auth/session";
import { verifyMeetingView } from "@/lib/auth/meeting-view";

/** Request header carrying the self-serve VIEW token (never a query param, so it
 *  cannot leak via a shareable URL, referrer, or server logs). */
export const MEETING_VIEW_HEADER = "x-cs-view";

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

/**
 * The extended published gate for the meeting DETAIL read (transcript +
 * summary), used by GET /api/meetings/[id] and POST .../request-publish.
 *
 * Readable when the meeting is published, OR the caller is staff, OR the caller
 * presents a valid self-serve VIEW token for THIS meeting's id (in the
 * `x-cs-view` request header). The view token is single-meeting scoped (a token
 * for A is rejected for B) and is verified with config.sessionSecret.
 *
 * It deliberately does NOT widen anything else: the export route, the library,
 * search, and topics stay published-or-staff only, so a view token can read one
 * meeting's detail but never download it or surface unpublished content
 * elsewhere. In open mode (no sessionSecret) isStaffRequest already returns true
 * for everyone, so the token check is moot and skipped.
 */
export async function canReadMeetingDetail(
  request: Request,
  meeting: { id: string; published: boolean }
): Promise<boolean> {
  if (meeting.published) return true;
  if (await isStaffRequest(request)) return true;

  const secret = getConfig().sessionSecret;
  // No session secret => open mode: isStaffRequest above already returned true,
  // so reaching here means the gate is genuinely closed and there is no key to
  // verify a view token against.
  if (!secret) return false;

  const token = request.headers.get(MEETING_VIEW_HEADER);
  return verifyMeetingView(token, secret, meeting.id);
}
