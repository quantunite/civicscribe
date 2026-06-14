// GET /api/meetings/[id] — full MeetingDetail (meeting + transcript +
// utterances + summary). Polled by the meeting detail view while the
// processing pipeline runs.

import { NextResponse } from "next/server";
import { getFileStorage, getStore } from "@/lib/store";
import { requireAdmin } from "@/lib/owner";
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

// DELETE /api/meetings/[id] — remove the meeting, its dependent rows
// (transcript, utterances, summary, jobs), and its audio blob. Idempotent-ish:
// a missing meeting returns 404.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const store = getStore();

  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Delete the audio blob first (best-effort — a missing/failed blob delete
  // must not strand the meeting row).
  if (meeting.audio_storage_path) {
    await getFileStorage()
      .delete(meeting.audio_storage_path)
      .catch(() => {});
  }

  await store.deleteMeeting(id);
  return new Response(null, { status: 204 });
}
