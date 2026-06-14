// POST /api/owner-login — exchange the OWNER_SECRET for the admin session
// cookie. Body: { secret: string }. On a constant-time match (via isAuthorized)
// set the HttpOnly, SameSite=Lax, Secure cs-owner cookie; 401 on a miss.
//
// SameSite=Lax (not Strict): Lax still blocks the cookie on cross-site POST, so
// every mutation (all POST/PATCH/DELETE routes) keeps its CSRF protection. Lax
// only relaxes top-level GET navigations, which stops the owner being silently
// logged out when arriving from an external link or a fresh tab.
//
// Complete no-op when OWNER_SECRET is unset: there is no admin gate to unlock,
// so we return ok WITHOUT setting any cookie (open mode).

import { NextResponse } from "next/server";
import { z } from "zod";

import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";
import { OWNER_COOKIE } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ secret: z.string() });

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getConfig().ownerSecret;

  // Open mode: nothing to unlock, so accept without minting a cookie.
  if (!secret) {
    return NextResponse.json({ ok: true, open: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, {
      status: 400,
    });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "secret is required" }, { status: 400 });
  }

  if (!isAuthorized(parsed.data.secret, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(OWNER_COOKIE, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    // 30 days; the admin re-authenticates after that.
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
