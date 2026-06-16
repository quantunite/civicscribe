// GET /api/meetings/[id] — full MeetingDetail (meeting + transcript +
// utterances + summary). Polled by the meeting detail view while the
// processing pipeline runs.

import { NextResponse } from "next/server";
import { getFileStorage, getStore } from "@/lib/store";
import { requireStaff } from "@/lib/owner";
import { canReadMeetingDetail } from "@/lib/auth/server";
import type { MeetingDetail, Utterance } from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();

  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Published boundary on the per-item read, extended for self-serve: an
  // unpublished (pending-review) meeting is reachable by direct UUID only by
  // staff OR by the submitter presenting a valid single-meeting VIEW token (the
  // x-cs-view header) for THIS id. Otherwise 404 (not 401) so its existence is
  // not even confirmed. The token opens ONLY this detail read; it does not grant
  // export/download (that route stays staff-or-published) and never widens the
  // library/search/topics surfaces.
  if (!(await canReadMeetingDetail(req, meeting))) {
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
  // no-store: an unpublished meeting's detail (reachable with a view token) must
  // never be cached by a shared/CDN layer where another caller could read it.
  return NextResponse.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
}

// DELETE /api/meetings/[id] — remove the meeting, its dependent rows
// (transcript, utterances, summary, jobs), and its audio blob. Idempotent-ish:
// a missing meeting returns 404.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const denied = await requireStaff(req);
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
