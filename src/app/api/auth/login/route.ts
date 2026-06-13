// POST /api/auth/login — exchange the shared password for a session cookie.
// Accepts JSON { password, next? }. Returns 401 on mismatch.

import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  checkPassword,
  createSessionToken,
  isAuthEnabled,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthEnabled()) {
    // Nothing to sign in to; treat as success so the client can move on.
    return NextResponse.json({ ok: true, next: "/" });
  }

  let password = "";
  let next = "/";
  try {
    const body = (await req.json()) as { password?: unknown; next?: unknown };
    if (typeof body.password === "string") {
      password = body.password;
    }
    // Only honor same-origin relative paths to avoid open-redirects.
    if (typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//")) {
      next = body.next;
    }
  } catch {
    // fall through to the invalid-password response
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true, next });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
