// POST /api/meetings/[id]/request-publish — the submitter (or staff) asks to add
// this meeting to the public record. Sets publish_requested_at (idempotent) so
// the staff review queue surfaces the intent. Publication still requires staff
// approval (POST .../publish).
//
// Authorized by the same gate as the detail read: the creator presenting a valid
// single-meeting VIEW token (x-cs-view header) OR a staff caller. This is NOT a
// download/export and does not publish; it only records a request.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canReadMeetingDetail } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();

  const meeting = await store.getMeeting(id);
  // 404 for a missing meeting.
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Same access gate as the detail read: staff, or the creator with a valid
  // single-meeting view token for THIS id. A token for a different meeting, or
  // no token, does not qualify -> 403. (This is a mutation on a known id the
  // caller is acting on, so 403 is appropriate; the detail read uses 404 to
  // avoid confirming existence on a pure read.)
  if (!(await canReadMeetingDetail(request, meeting))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await store.requestPublish(id);
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
