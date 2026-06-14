// GET /api/meetings/[id]/export?format=txt|md|srt|json
// Returns the meeting transcript (and, for md/json, the summary) as a
// downloadable file with a Content-Disposition attachment header.

import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { isAdminRequest } from "@/lib/owner";
import type { MeetingDetail, Utterance } from "@/lib/types";
import {
  EXPORT_CONTENT_TYPES,
  exportFilename,
  isExportFormat,
  renderExport,
} from "@/lib/export/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "txt";
  if (!isExportFormat(format)) {
    return NextResponse.json(
      { error: `Unsupported format: ${format}. Use txt, md, srt, or json.` },
      { status: 400 }
    );
  }

  const store = getStore();
  const meeting = await store.getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Published boundary: an unpublished meeting's transcript must not be
  // exportable by direct UUID for the public. 404 (not 401) so existence is
  // not confirmed. Admins can export anything.
  if (!meeting.published && !isAdminRequest(req)) {
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
  const body = renderExport(detail, format);

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": EXPORT_CONTENT_TYPES[format],
      "content-disposition": `attachment; filename="${exportFilename(detail, format)}"`,
      "cache-control": "no-store",
    },
  });
}
