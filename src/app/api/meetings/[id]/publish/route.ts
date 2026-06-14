// POST /api/meetings/[id]/publish — admin approves a generated meeting into the
// public library (sets published + published_at). Idempotent. Admin gated:
// publishing is the moderation action. Returns the updated meeting.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { requireAdmin } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse | Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    const meeting = await getStore().publishMeeting(id);
    return NextResponse.json(meeting);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meeting not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
