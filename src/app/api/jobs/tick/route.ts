// POST /api/jobs/tick — claim and process at most one pending job.
// Driven by the dev worker (scripts/worker.ts) every 5 seconds; can also be
// hit by any external scheduler in production. processOneJob never throws,
// so this route always returns 200 with a result body.

import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/jobs/runner";
import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  // Open when TICK_SECRET is unset (dev/single-user); enforced once it is set
  // so a public deployment's tick endpoint can't be driven by anyone.
  if (!isAuthorized(request.headers.get("authorization"), getConfig().tickSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processOneJob();
  return NextResponse.json(result);
}
