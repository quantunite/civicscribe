// GET /api/search?q=<query>[&meetingId=<id>] — full-text search across
// utterances. The /search page renders server-side; this JSON endpoint exists
// for programmatic clients and future in-app use.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";

const querySchema = z.object({
  q: z.string().trim().min(1, "q is required"),
  meetingId: z.string().trim().min(1).optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    meetingId: url.searchParams.get("meetingId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { q, meetingId } = parsed.data;
  const results = await getStore().searchUtterances(
    q,
    meetingId ? { meetingId } : undefined
  );
  return NextResponse.json({ results });
}
