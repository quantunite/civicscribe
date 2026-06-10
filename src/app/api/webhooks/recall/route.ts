// POST /api/webhooks/recall — Recall.ai webhook receiver.
//
// The capture stage polls getBotStatus and is the source of truth for when a
// recording is ready; this webhook is only an accelerator that nudges the job
// runner so a pending job gets picked up sooner. We therefore tolerate any
// payload shape (Recall event envelopes vary), always return 200, and kick
// processOneJob() fire-and-forget on every event — a tick is cheap and
// idempotent (it claims one pending job or no-ops).

import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Best-effort extraction of an event name from a Recall webhook payload. */
function eventName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  for (const key of ["event", "type", "event_type"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Tolerate empty or non-JSON bodies.
  }

  const event = eventName(body);
  console.log(`[webhook:recall] received event: ${event ?? "(unknown shape)"}`);

  void processOneJob().catch((err) => {
    console.error("[webhook:recall] job tick failed:", err);
  });

  return NextResponse.json({ received: true, event });
}
