// GET /api/meetings/[id]/live — the live-transcript poll endpoint.
//
// PUBLIC by design: the live transcript is public while a meeting is being
// captured. The browser polls this every ~2s with ?since=<cursor> and appends
// any new lines. v1 uses polling, not Supabase Realtime. Cache-Control is
// no-store so a poll always sees the latest lines.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

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

  return NextResponse.json(
    {
      utterances,
      phase,
      live: phase === "live",
      status: meeting.status,
      published: meeting.published,
      cursor,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
