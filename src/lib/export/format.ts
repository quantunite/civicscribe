// Pure formatters that turn a MeetingDetail into a downloadable transcript in
// one of four formats. Diarized transcripts show speaker labels; caption
// transcripts (transcript.diarized === false) render text only.

import type { MeetingDetail, Utterance } from "@/lib/types";
import { summaryLabels } from "@/lib/summary-labels";

export type ExportFormat = "txt" | "md" | "srt" | "json";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export function isExportFormat(value: string): value is ExportFormat {
  return value === "txt" || value === "md" || value === "srt" || value === "json";
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** mm:ss, widening to h:mm:ss once past an hour. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** SRT timecode HH:MM:SS,mmm. */
function srtTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const msPart = clamped % 1000;
  const total = Math.floor(clamped / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msPart, 3)}`;
}

function speakerOf(u: Utterance): string {
  return u.speaker_name ?? `Speaker ${u.speaker_label}`;
}

function isDiarized(detail: MeetingDetail): boolean {
  return detail.transcript?.diarized ?? true;
}

function meetingDate(detail: MeetingDetail): string {
  return detail.meeting.created_at.slice(0, 10);
}

export function toTxt(detail: MeetingDetail): string {
  const { meeting, utterances } = detail;
  const diarized = isDiarized(detail);
  const lines: string[] = [meeting.title, `${meeting.body_name} — ${meetingDate(detail)}`];
  if (!diarized) lines.push("(Transcript from auto-captions — no speaker labels)");
  lines.push("");
  if (utterances.length === 0) {
    lines.push("(No transcript available.)");
  } else {
    for (const u of utterances) {
      const ts = `[${clock(u.start_ms)}]`;
      lines.push(diarized ? `${ts} ${speakerOf(u)}: ${u.text}` : `${ts} ${u.text}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function toMarkdown(detail: MeetingDetail): string {
  const { meeting, utterances, summary } = detail;
  const diarized = isDiarized(detail);
  const out: string[] = [`# ${meeting.title}`, "", `**${meeting.body_name}** · ${meetingDate(detail)}`, ""];

  if (summary) {
    const labels = summaryLabels(meeting.kind);
    out.push("## Summary", "", summary.overview, "");
    if (summary.key_decisions.length > 0) {
      out.push(`### ${labels.keyPoints}`, "");
      for (const d of summary.key_decisions) out.push(`- ${d}`);
      out.push("");
    }
    if (summary.action_items.length > 0) {
      out.push(`### ${labels.takeaways}`, "");
      for (const a of summary.action_items) out.push(`- ${a}`);
      out.push("");
    }
    if (summary.topics.length > 0) {
      out.push("### Topics", "", summary.topics.join(", "), "");
    }
  }

  out.push("## Transcript", "");
  if (!diarized) out.push("_From auto-captions — no speaker labels._", "");
  if (utterances.length === 0) {
    out.push("_No transcript available._");
  } else {
    for (const u of utterances) {
      const ts = `[${clock(u.start_ms)}]`;
      out.push(diarized ? `${ts} **${speakerOf(u)}:** ${u.text}` : `${ts} ${u.text}`, "");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

export function toSrt(detail: MeetingDetail): string {
  const { utterances } = detail;
  const diarized = isDiarized(detail);
  const blocks = utterances.map((u, i) => {
    const text = diarized ? `${speakerOf(u)}: ${u.text}` : u.text;
    // A valid SRT cue needs end > start.
    const end = u.end_ms > u.start_ms ? u.end_ms : u.start_ms + 1000;
    return `${i + 1}\n${srtTime(u.start_ms)} --> ${srtTime(end)}\n${text}`;
  });
  return blocks.join("\n\n") + "\n";
}

export function toJson(detail: MeetingDetail): string {
  const { meeting, transcript, utterances, summary } = detail;
  return (
    JSON.stringify(
      {
        meeting: {
          id: meeting.id,
          title: meeting.title,
          body_name: meeting.body_name,
          source_type: meeting.source_type,
          source_url: meeting.source_url,
          status: meeting.status,
          duration_seconds: meeting.duration_seconds,
          created_at: meeting.created_at,
        },
        transcript: transcript
          ? { language: transcript.language, diarized: transcript.diarized }
          : null,
        utterances: utterances.map((u) => ({
          speaker_label: u.speaker_label,
          speaker_name: u.speaker_name,
          start_ms: u.start_ms,
          end_ms: u.end_ms,
          text: u.text,
        })),
        summary: summary
          ? {
              overview: summary.overview,
              key_decisions: summary.key_decisions,
              action_items: summary.action_items,
              topics: summary.topics,
            }
          : null,
      },
      null,
      2
    ) + "\n"
  );
}

export function renderExport(detail: MeetingDetail, format: ExportFormat): string {
  switch (format) {
    case "txt":
      return toTxt(detail);
    case "md":
      return toMarkdown(detail);
    case "srt":
      return toSrt(detail);
    case "json":
      return toJson(detail);
  }
}

/** Filesystem-safe slug from the meeting title (falls back to "transcript"). */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "transcript"
  );
}

export function exportFilename(detail: MeetingDetail, format: ExportFormat): string {
  return `${slugify(detail.meeting.title)}.${format}`;
}
