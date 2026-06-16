// POST /api/webhooks/recall — Recall.ai webhook receiver.
//
// Two roles:
//  1. Accelerator for the batch pipeline: for non-transcript events it nudges
//     the job runner so a pending job gets picked up sooner. The capture stage
//     polls getBotStatus and is the source of truth, so even a dropped webhook
//     can't lose data. We tolerate any payload shape, always return 200, and
//     kick processOneJob() fire-and-forget — a tick is cheap and idempotent.
//  2. Live-captions ingest: a "transcript.data" event carries one finalized
//     utterance from the bot's real-time transcript. When the target meeting
//     opted into live captions we append it to live_utterances (which the
//     public live page polls) and stamp live_started_at on the first line.
//     transcript.data is NOT a job trigger, so it does not kick processOneJob.

import { NextResponse } from "next/server";
import { processOneJob } from "@/lib/jobs/runner";
import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";
import { getStore } from "@/lib/store";

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

/** One finalized utterance parsed from a transcript.data payload, or null when
 *  the shape is unusable. NOTE the double nesting: words/participant live at
 *  data.data.*, while bot lives at data.* . Every access is guarded so a novel
 *  payload shape never throws. */
interface ParsedUtterance {
  meetingId: string;
  text: string;
  speaker: string | null;
  tsSeconds: number | null;
}

function parseTranscriptData(body: unknown): ParsedUtterance | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;

  const inner = (data as { data?: unknown }).data;
  const bot = (data as { bot?: unknown }).bot;

  const meetingId =
    typeof bot === "object" && bot !== null
      ? (bot as { metadata?: { civicscribe_meeting_id?: unknown } }).metadata
          ?.civicscribe_meeting_id
      : undefined;
  if (typeof meetingId !== "string" || meetingId === "") return null;

  const words =
    typeof inner === "object" && inner !== null
      ? (inner as { words?: unknown }).words
      : undefined;
  const wordList = Array.isArray(words)
    ? (words as Array<{
        text?: unknown;
        start_timestamp?: { relative?: unknown } | null;
      }>)
    : [];

  const text = wordList
    .map((w) => (typeof w?.text === "string" ? w.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const participant =
    typeof inner === "object" && inner !== null
      ? (inner as { participant?: unknown }).participant
      : undefined;
  let speaker: string | null = null;
  if (typeof participant === "object" && participant !== null) {
    const p = participant as { id?: unknown; name?: unknown };
    if (typeof p.name === "string" && p.name.trim() !== "") {
      speaker = p.name;
    } else if (p.id != null) {
      speaker = `Speaker ${String(p.id)}`;
    }
  }

  const firstRel = wordList[0]?.start_timestamp?.relative;
  const tsSeconds = typeof firstRel === "number" ? firstRel : null;

  return { meetingId, text, speaker, tsSeconds };
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = getConfig();

  // A public deploy MUST authenticate this webhook. transcript.data ingest writes
  // straight to the public live transcript, and the meeting UUID is visible in
  // the public live-page URL, so an open endpoint would let anyone inject forged
  // caption lines. In real (non-mock) mode, refuse to run without a configured
  // secret, mirroring how the Supabase store refuses to run without credentials.
  // Mock mode has no real Recall bot calling this, so it stays open for local dev.
  if (!config.mockMode && !config.recallWebhookSecret) {
    return NextResponse.json(
      { error: "webhook not configured" },
      { status: 503 }
    );
  }

  // Shared-secret auth: when RECALL_WEBHOOK_SECRET is set, the URL registered with
  // Recall must carry it (?token=<secret>, or an Authorization header), compared
  // constant-time. Open only in mock mode (guarded above).
  const token =
    new URL(request.url).searchParams.get("token") ??
    request.headers.get("authorization");
  if (!isAuthorized(token, config.recallWebhookSecret)) {
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

  // Live-captions ingest. transcript.data carries one finalized utterance; it is
  // not a job trigger, so it never kicks the runner. Tolerate any shape and never
  // throw (still 200 on anything).
  if (event === "transcript.data") {
    try {
      const parsed = parseTranscriptData(body);
      if (parsed && parsed.text !== "") {
        const store = getStore();
        const meeting = await store.getMeeting(parsed.meetingId);
        if (meeting && meeting.live_enabled) {
          await store.appendLiveUtterance(meeting.id, {
            speaker_label: parsed.speaker,
            text: parsed.text,
            ts_seconds: parsed.tsSeconds,
          });
          if (meeting.live_started_at == null) {
            await store.updateMeeting(meeting.id, {
              live_started_at: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      console.error("[webhook:recall] live ingest failed:", err);
    }
    return NextResponse.json({ received: true, event });
  }

  void processOneJob().catch((err) => {
    console.error("[webhook:recall] job tick failed:", err);
  });

  return NextResponse.json({ received: true, event });
}
