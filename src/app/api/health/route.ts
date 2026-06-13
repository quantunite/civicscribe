// GET /api/health — lightweight liveness check for hosting platforms.
// Always 200, never gated by auth (see middleware PUBLIC_PREFIXES).

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}
