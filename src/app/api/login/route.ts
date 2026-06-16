// POST /api/login — email + password -> the cs-session cookie.
//
// Body: { email, password }. On a match, set the HttpOnly, SameSite=Lax, Secure
// cs-session cookie carrying { uid, role, exp } (HMAC-signed, no DB lookup to
// authorize later). Generic 401 on any miss (no user-enumeration).
//
// Complete no-op when SESSION_SECRET is unset: there is no auth gate to unlock,
// so return ok WITHOUT a cookie (open/dev mode), mirroring /api/owner-login.
//
// Calls ensureBootstrapAdmin first so a fresh deploy can always seat its first
// admin from BOOTSTRAP_ADMIN_EMAIL/PASSWORD on the very first login attempt.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { verifyPassword } from "@/lib/auth/password";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";
import { ensureBootstrapAdmin } from "@/lib/auth/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string(), password: z.string() });

// A well-formed scrypt hash that nothing matches. Verifying against it when the
// email is unknown keeps response timing similar whether or not a user exists.
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function POST(request: Request): Promise<NextResponse> {
  const config = getConfig();

  // Open mode: no session secret means no gate to unlock.
  if (!config.sessionSecret) {
    return NextResponse.json({ ok: true, open: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const store = getStore();
  // Seat the first admin on demand so a fresh deploy is never locked out.
  await ensureBootstrapAdmin(store, config);

  const user = await store.getUserByEmail(parsed.data.email);
  const ok = await verifyPassword(
    parsed.data.password,
    user?.password_hash ?? DUMMY_HASH
  );
  if (!user || !ok) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession(
    { uid: user.id, role: user.role, exp },
    config.sessionSecret
  );

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production (HTTPS) only: a Secure cookie is dropped by the
    // browser over plain http://localhost, which would silently break sign-in
    // during local testing.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
