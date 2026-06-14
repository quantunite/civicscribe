// POST /api/owner-logout — clear the admin session cookie. Always ok (logging
// out when not logged in is a no-op). The cookie is cleared with Max-Age=0.

import { NextResponse } from "next/server";

import { OWNER_COOKIE } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OWNER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
