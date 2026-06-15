// Edge middleware: the access boundary for CivicScribe's ADMIN surface.
//
// EDGE-SAFE: runs in the Next.js edge runtime, so it reads process.env directly
// and only imports the edge-safe session verifier (Web Crypto, no node:crypto,
// no store). The owner-secret compare is a small inline constant-time impl.
//
// Two credentials are accepted on the admin surface:
//   1. cs-session: a per-user signed token { uid, role, exp }. Phase 1 lets any
//      signed-in staff (admin or moderator) through the existing admin gates.
//   2. cs-owner: the legacy shared OWNER_SECRET (kept as break-glass during the
//      cutover to accounts; scripts still send it as a Bearer header).
//
// HARD INVARIANT: when BOTH SESSION_SECRET and OWNER_SECRET are unset the
// middleware is a COMPLETE pass-through (no-op), so dev (MOCK_MODE) and the
// whole test suite are unaffected. When either is set, the admin surface needs
// a valid credential: /api/* -> 401 JSON, pages -> redirect to /owner-login.
// Public reads/search/export/audio and the public generate routes stay open.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

const OWNER_COOKIE = "cs-owner";

/** Constant-time string compare (edge-safe; no node:crypto). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Read one cookie value out of a raw Cookie header. */
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Legacy break-glass: the cs-owner cookie OR an Authorization: Bearer header
 *  matching the shared OWNER_SECRET. */
function hasValidOwnerCredential(request: NextRequest, secret: string): boolean {
  const cookie = readCookie(request.headers.get("cookie"), OWNER_COOKIE);
  if (cookie && safeEqual(cookie, secret)) return true;

  const auth = request.headers.get("authorization");
  if (auth) {
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : auth;
    if (safeEqual(token, secret)) return true;
  }
  return false;
}

/** Per-user session: a valid signed cs-session whose role clears the admin gate.
 *  Phase 1 admits admin AND moderator (the admin/moderator split is Phase 2). */
async function hasValidSession(
  request: NextRequest,
  sessionSecret: string
): Promise<boolean> {
  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const payload = await verifySession(cookie, sessionSecret);
  return !!payload && (payload.role === "admin" || payload.role === "moderator");
}

/** Is this request on the admin surface (must be authorized to proceed)? Method
 *  AND path matter: GET reads of the same paths are public. */
function isAdminSurface(method: string, pathname: string): boolean {
  // --- gated pages (any method, normally GET navigations) ---
  // /meetings/new, /study-notes/new, /schedules (+ /schedules/new) are
  // deliberately PUBLIC (generation is open-with-guardrails). Only manage /
  // publish / recurring actions are gated.
  const ADMIN_PAGES = ["/review"];
  for (const page of ADMIN_PAGES) {
    if (pathname === page || pathname.startsWith(`${page}/`)) return true;
  }

  // --- gated API routes (method specific) ---

  // POST /api/meetings/[id]/speakers, /publish, /unpublish; DELETE /api/meetings/[id]
  if (pathname.startsWith("/api/meetings/")) {
    const sub = pathname.slice("/api/meetings/".length);
    const slash = sub.indexOf("/");
    const tail = slash === -1 ? "" : sub.slice(slash + 1);
    if (tail === "" && method === "DELETE") return true;
    if (
      method === "POST" &&
      (tail === "speakers" || tail === "publish" || tail === "unpublish")
    ) {
      return true;
    }
    return false;
  }

  // PATCH /api/utterances/[id]
  if (pathname.startsWith("/api/utterances/") && method === "PATCH") {
    return true;
  }

  // /api/schedules: POST passes through (handler decides one-off-public vs
  // recurring-admin). GET list is public.
  if (pathname === "/api/schedules") {
    return false;
  }
  // /api/schedules/[id]: PATCH + DELETE (pause/edit/delete) stay admin-gated.
  if (pathname.startsWith("/api/schedules/")) {
    if (method === "PATCH" || method === "DELETE") return true;
    return false;
  }

  return false;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const ownerSecret = process.env.OWNER_SECRET?.trim() ?? "";
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";

  // No-op fast path: when NEITHER gate is configured the access layer is off.
  if (!ownerSecret && !sessionSecret) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const method = request.method;

  if (!isAdminSurface(method, pathname)) {
    return NextResponse.next();
  }

  const authorized =
    (!!ownerSecret && hasValidOwnerCredential(request, ownerSecret)) ||
    (!!sessionSecret && (await hasValidSession(request, sessionSecret)));

  if (authorized) {
    return NextResponse.next();
  }

  // Denied. JSON for the API, a login redirect for pages.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/owner-login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

// Precise matcher: only the namespaces that contain gated routes + the gated
// pages. Method gating happens in middleware(). EXCLUDES /api/jobs/tick and
// /api/webhooks/recall (already secret-gated), the auth routes, all static
// assets, and the rest of the public site.
export const config = {
  matcher: [
    "/api/meetings/:path*",
    "/api/utterances/:path*",
    "/api/schedules/:path*",
    "/schedules/:path*",
    "/schedules",
    "/review/:path*",
    "/review",
  ],
};
