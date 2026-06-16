// POST /api/meetings/[id]/unpublish — admin removes a meeting from the public
// library (clears published + published_at). Admin gated. Returns the updated
// meeting.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireStaff } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse | Response> {
  const denied = await requireStaff(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    const meeting = await getStore().unpublishMeeting(id);
    return NextResponse.json(meeting);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meeting not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
