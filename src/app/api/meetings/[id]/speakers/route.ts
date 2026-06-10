// POST /api/meetings/[id]/speakers — apply a display name to every utterance
// in the meeting's transcript that has the given speaker_label, and persist a
// speaker_alias so recurring meetings of the same body reuse the mapping.
// Body: { speaker_label: string, display_name: string }. Returns {updated: n}.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";

const bodySchema = z.object({
  speaker_label: z
    .string()
    .trim()
    .min(1, "speaker_label must be a non-empty string"),
  display_name: z
    .string()
    .trim()
    .min(1, "display_name must be a non-empty string"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const store = getStore();

  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const transcript = await store.getTranscriptByMeeting(meeting.id);
  if (!transcript) {
    return NextResponse.json(
      { error: "Meeting has no transcript yet" },
      { status: 404 }
    );
  }

  const { speaker_label, display_name } = parsed.data;

  const updated = await store.applySpeakerNameToLabel(
    transcript.id,
    speaker_label,
    display_name
  );
  await store.upsertSpeakerAlias({
    body_name: meeting.body_name,
    speaker_label_pattern: speaker_label,
    display_name,
  });

  return NextResponse.json({ updated });
}
