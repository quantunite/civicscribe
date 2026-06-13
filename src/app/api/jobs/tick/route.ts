// /api/jobs/tick — claim and process at most one pending job.
// Driven by the dev worker (scripts/worker.ts) every 5 seconds, or by any
// external scheduler in production. processOneJob never throws, so a tick
// always returns 200 with a result body.
//
// When CRON_SECRET is set, callers must present it as `Authorization: Bearer
// <secret>` (also how Vercel Cron authenticates) or an `x-cron-secret` header.
// Both GET and POST are accepted so platforms that only issue GET crons work.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { timingSafeEqual } from "@/lib/auth";
import { processOneJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = getConfig().cronSecret;
  if (!secret) {
    return true;
  }
  const header = req.headers.get("authorization");
  const provided = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : req.headers.get("x-cron-secret");
  return provided !== null && provided !== undefined && timingSafeEqual(provided, secret);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processOneJob();
  return NextResponse.json(result);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
