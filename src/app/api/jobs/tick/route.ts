// POST /api/jobs/tick — claim and process at most one pending job.
// Driven by the dev worker (scripts/worker.ts) every 5 seconds; can also be
// hit by any external scheduler in production. processOneJob never throws,
// so this route always returns 200 with a result body.

import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/jobs/runner";
import { sweepSchedules } from "@/lib/jobs/scheduler";
import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  // Open when TICK_SECRET is unset (dev/single-user); enforced once it is set
  // so a public deployment's tick endpoint can't be driven by anyone.
  if (!isAuthorized(request.headers.get("authorization"), getConfig().tickSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Materialize any due schedules first, so a freshly-created capture job is
  // available for the job step below. A sweep failure must not block jobs.
  let schedulesFired = 0;
  try {
    const swept = await sweepSchedules(getStore());
    schedulesFired = swept.fired.filter((f) => f.meetingId && !f.skipped).length;
    for (const f of swept.fired) {
      if (f.fireFailed) {
        console.error(
          `[tick] schedule ${f.scheduleId} failed to fire occurrence ${f.occurrenceKey} (will retry): ${f.error}`
        );
      }
    }
  } catch (err) {
    console.error("[tick] schedule sweep failed:", err);
  }

  const result = await processOneJob();
  return NextResponse.json({ ...result, schedulesFired });
}
