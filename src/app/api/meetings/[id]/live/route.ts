// GET /api/meetings/[id]/live — the live-transcript poll endpoint.
//
// PUBLIC by design: the live transcript is public while a meeting is being
// captured. The browser polls this every ~2s with ?since=<cursor> and appends
// any new lines. v1 uses polling, not Supabase Realtime. Cache-Control is
// no-store so a poll always sees the latest lines.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { getProviders } from "@/lib/providers";
import { maybeRefreshCatchUp } from "@/lib/live/catchup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const store = getStore();
  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const sinceParam = new URL(request.url).searchParams.get("since");
  const sinceNum = sinceParam != null ? Number.parseInt(sinceParam, 10) : NaN;
  const since = Number.isFinite(sinceNum) && sinceNum >= 0 ? sinceNum : undefined;

  const utterances = await store.listLiveUtterances(id, since);
  const cursor =
    utterances.length > 0
      ? utterances[utterances.length - 1].id
      : (since ?? 0);

  // Tri-state so the client never confuses "not started yet" with "over":
  //  - waiting: opted in, bot has not joined yet (status still pending)
  //  - live:    bot is in the call recording (status capturing)
  //  - ended:   published, not live-enabled, or past capture (transcribing+)
  const phase: "waiting" | "live" | "ended" =
    meeting.published || !meeting.live_enabled
      ? "ended"
      : meeting.status === "capturing"
        ? "live"
        : meeting.status === "pending"
          ? "waiting"
          : "ended";

  // Keep the rolling "here's what you missed" recap warm: refresh it lazily and
  // fire-and-forget while the meeting is live (the same post-response promise
  // pattern the Recall webhook uses; Railway's long-lived Node server keeps it
  // running). The refresh is best-effort and self-throttling (stale gate +
  // optimistic debounce), so this never spends per viewer and never slows the
  // poll. We do NOT await it.
  if (phase === "live") {
    const providers = getProviders();
    void maybeRefreshCatchUp(meeting, store, providers).catch(() => {});
  }

  return NextResponse.json(
    {
      utterances,
      phase,
      live: phase === "live",
      status: meeting.status,
      published: meeting.published,
      cursor,
      catchUp: meeting.live_summary
        ? { text: meeting.live_summary, updatedAt: meeting.live_summary_at }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
