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
import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";

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
  // Interim shared-secret auth: when RECALL_WEBHOOK_SECRET is set, the URL
  // registered with Recall must carry it (?token=<secret>, or an Authorization
  // header). Open when unset. This route is only an accelerator, so even a
  // rejected webhook can't lose data — the capture stage polls bot status as
  // the source of truth. (Switch to Svix signature verification once a real
  // Recall endpoint is registered.)
  const token =
    new URL(request.url).searchParams.get("token") ??
    request.headers.get("authorization");
  if (!isAuthorized(token, getConfig().recallWebhookSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
