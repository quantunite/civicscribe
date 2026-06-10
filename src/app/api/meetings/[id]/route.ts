// GET /api/meetings/[id] — full MeetingDetail (meeting + transcript +
// utterances + summary). Polled by the meeting detail view while the
// processing pipeline runs.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import type { MeetingDetail, Utterance } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();

  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const transcript = await store.getTranscriptByMeeting(meeting.id);
  const [utterances, summary] = await Promise.all([
    transcript
      ? store.listUtterances(transcript.id)
      : Promise.resolve<Utterance[]>([]),
    store.getSummaryByMeeting(meeting.id),
  ]);

  const detail: MeetingDetail = { meeting, transcript, utterances, summary };
  return NextResponse.json(detail);
}
