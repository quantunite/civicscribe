// PATCH /api/utterances/[id] — set the speaker_name on a single utterance.
// Body: { speaker_name: string } (non-empty). Returns the updated utterance.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";

const patchSchema = z.object({
  speaker_name: z
    .string()
    .trim()
    .min(1, "speaker_name must be a non-empty string"),
});

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const utterance = await getStore().updateUtteranceSpeakerName(
      id,
      parsed.data.speaker_name
    );
    return NextResponse.json(utterance);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Utterance not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
