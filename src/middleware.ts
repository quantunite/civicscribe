// Edge middleware: the access boundary for CivicScribe's ADMIN surface.
//
// EDGE-SAFE: this runs in the Next.js edge runtime, so it reads
// process.env.OWNER_SECRET DIRECTLY and does NOT import getConfig, the store,
// node:crypto, or any other Node-only module. The constant-time compare is a
// small inline implementation (no node:crypto/timingSafeEqual on the edge).
//
// HARD INVARIANT: when OWNER_SECRET is unset the middleware is a COMPLETE
// pass-through (no-op), so dev (MOCK_MODE) and the entire test suite are
// unaffected.
//
// When set, the admin surface requires the cs-owner cookie OR an
// Authorization: Bearer header:
//   - /api/* -> 401 JSON
//   - pages  -> redirect to /owner-login
// Everything else (public GET reads, GET /api/search, export, /api/audio, and
// the public generate routes POST /api/meetings + POST /api/upload) stays open.
// The already-secret-gated /api/jobs/tick + /api/webhooks/recall are excluded
// by the matcher.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const OWNER_COOKIE = "cs-owner";

/** Constant-time string compare (edge-safe; no node:crypto). Returns false on
 *  a length mismatch, then XOR-accumulates over the whole string so timing
 *  does not leak the position of the first differing byte. */
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

function hasValidCredential(request: NextRequest, secret: string): boolean {
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

/** Is this request on the admin surface (must be an admin to proceed)? Method
 *  AND path matter: GET reads of the same paths are public. */
function isAdminSurface(method: string, pathname: string): boolean {
  // --- gated pages (any method, normally GET navigations) ---
  const ADMIN_PAGES = [
    "/schedules",
    "/meetings/new",
    "/crash-course/new",
    "/review", // the moderation queue page
  ];
  for (const page of ADMIN_PAGES) {
    if (pathname === page || pathname.startsWith(`${page}/`)) return true;
  }

  // --- gated API routes (method specific) ---

  // POST /api/meetings/[id]/speakers, /publish, /unpublish; DELETE /api/meetings/[id]
  // (but NOT POST /api/meetings, GET reads, or /export — those are public).
  if (pathname.startsWith("/api/meetings/")) {
    const sub = pathname.slice("/api/meetings/".length); // "<id>" or "<id>/..."
    const slash = sub.indexOf("/");
    const tail = slash === -1 ? "" : sub.slice(slash + 1);
    if (tail === "" && method === "DELETE") return true; // DELETE /api/meetings/[id]
    if (
      method === "POST" &&
      (tail === "speakers" || tail === "publish" || tail === "unpublish")
    ) {
      return true;
    }
    return false; // GET detail, GET export, etc. stay public
  }

  // PATCH /api/utterances/[id]
  if (
    pathname.startsWith("/api/utterances/") &&
    method === "PATCH"
  ) {
    return true;
  }

  // All POST/PATCH/DELETE on /api/schedules and /api/schedules/[id]
  // (GET list stays public).
  if (pathname === "/api/schedules" || pathname.startsWith("/api/schedules/")) {
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      return true;
    }
  }

  return false;
}

export function middleware(request: NextRequest): NextResponse {
  // No-op fast path: when OWNER_SECRET is unset the access layer is disabled.
  const secret = process.env.OWNER_SECRET;
  if (!secret || secret.trim() === "") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const method = request.method;

  if (!isAdminSurface(method, pathname)) {
    return NextResponse.next();
  }

  if (hasValidCredential(request, secret)) {
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
// /api/webhooks/recall (already secret-gated), all static assets, and the rest
// of the public site (which the function would pass through anyway).
export const config = {
  matcher: [
    "/api/meetings/:path*",
    "/api/utterances/:path*",
    "/api/schedules/:path*",
    "/schedules/:path*",
    "/schedules",
    "/meetings/new",
    "/crash-course/new/:path*",
    "/crash-course/new",
    "/review/:path*",
    "/review",
  ],
};
