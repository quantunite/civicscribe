// POST /api/jobs/tick — claim and process at most one pending job.
// Driven by the dev worker (scripts/worker.ts) every 5 seconds; can also be
// hit by any external scheduler in production. processOneJob never throws,
// so this route always returns 200 with a result body.

import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const result = await processOneJob();
  return NextResponse.json(result);
}
