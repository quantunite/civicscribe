// Transcript export formatters: txt / md / srt / json, diarized vs caption.

import { describe, expect, it } from "vitest";
import type {
  MeetingDetail,
  Meeting,
  Summary,
  Transcript,
  Utterance,
} from "@/lib/types";
import {
  exportFilename,
  isExportFormat,
  slugify,
  toJson,
  toMarkdown,
  toSrt,
  toTxt,
} from "@/lib/export/format";

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Council Regular Session",
    body_name: "Lawrence City Council",
    source_type: "stream",
    kind: "civic",
    source_url: "https://x/v",
    status: "complete",
    error_message: null,
    scheduled_at: null,
    audio_storage_path: null,
    duration_seconds: 65,
    schedule_id: null,
    occurrence_key: null,
    published: false,
    published_at: null,
    tenant_id: null,
    source_key: null,
    live_enabled: false,
    live_started_at: null,
    live_ended_at: null,
    live_summary: null,
    live_summary_through_id: null,
    live_summary_at: null,
    created_at: "2026-06-13T10:00:00.000Z",
    ...over,
  };
}

function transcript(diarized: boolean): Transcript {
  return {
    id: "t1",
    meeting_id: "m1",
    raw_json: {},
    language: "en",
    diarized,
    created_at: "2026-06-13T10:00:00.000Z",
  };
}

function utt(over: Partial<Utterance>): Utterance {
  return {
    id: "u",
    transcript_id: "t1",
    speaker_label: "A",
    speaker_name: null,
    start_ms: 0,
    end_ms: 5000,
    text: "hello",
    ...over,
  };
}

const summary: Summary = {
  id: "s1",
  meeting_id: "m1",
  overview: "The council approved the parks budget.",
  key_decisions: ["Approved parks budget 4-1"],
  action_items: ["Staff to publish the budget"],
  topics: ["parks", "budget"],
  full_markdown: "## Overview\n...",
};

const diarizedDetail: MeetingDetail = {
  meeting: meeting(),
  transcript: transcript(true),
  utterances: [
    utt({ id: "u1", speaker_label: "A", start_ms: 0, end_ms: 4000, text: "Good evening." }),
    utt({ id: "u2", speaker_label: "B", speaker_name: "Mayor Reyes", start_ms: 65000, end_ms: 67000, text: "Motion carries." }),
  ],
  summary,
};

const captionDetail: MeetingDetail = {
  meeting: meeting({ title: "YouTube Stream" }),
  transcript: transcript(false),
  utterances: [
    utt({ id: "c1", speaker_label: "CAPTION", start_ms: 0, end_ms: 4000, text: "Good evening." }),
    utt({ id: "c2", speaker_label: "CAPTION", start_ms: 4000, end_ms: 9000, text: "Meeting called to order." }),
  ],
  summary,
};

describe("toTxt", () => {
  it("includes speaker labels and timestamps when diarized", () => {
    const out = toTxt(diarizedDetail);
    expect(out).toContain("Council Regular Session");
    expect(out).toContain("[00:00] Speaker A: Good evening.");
    expect(out).toContain("[01:05] Mayor Reyes: Motion carries.");
  });

  it("omits speakers and notes captions when not diarized", () => {
    const out = toTxt(captionDetail);
    expect(out).toContain("auto-captions");
    expect(out).toContain("[00:00] Good evening.");
    expect(out).not.toContain("Speaker");
  });
});

describe("toMarkdown", () => {
  it("renders summary sections and a diarized transcript", () => {
    const out = toMarkdown(diarizedDetail);
    expect(out).toContain("# Council Regular Session");
    expect(out).toContain("## Summary");
    expect(out).toContain("### Key decisions");
    expect(out).toContain("- Approved parks budget 4-1");
    expect(out).toContain("## Transcript");
    expect(out).toContain("**Speaker A:** Good evening.");
  });

  it("relabels the summary sections for course videos", () => {
    const out = toMarkdown({
      ...captionDetail,
      meeting: meeting({ kind: "course" }),
    });
    expect(out).toContain("### Key concepts");
    expect(out).toContain("### Key takeaways");
    expect(out).not.toContain("### Key decisions");
    expect(out).not.toContain("### Action items");
  });
});

describe("toSrt", () => {
  it("emits numbered cues with SRT timecodes", () => {
    const out = toSrt(diarizedDetail);
    expect(out).toContain("1\n00:00:00,000 --> 00:00:04,000\nSpeaker A: Good evening.");
    expect(out).toContain("2\n00:01:05,000 --> 00:01:07,000\nMayor Reyes: Motion carries.");
  });

  it("drops speaker prefix for caption transcripts", () => {
    const out = toSrt(captionDetail);
    expect(out).toContain("00:00:00,000 --> 00:00:04,000\nGood evening.");
    expect(out).not.toContain("CAPTION");
  });
});

describe("toJson", () => {
  it("produces parseable structured data", () => {
    const parsed = JSON.parse(toJson(diarizedDetail));
    expect(parsed.meeting.id).toBe("m1");
    expect(parsed.transcript.diarized).toBe(true);
    expect(parsed.utterances).toHaveLength(2);
    expect(parsed.summary.overview).toContain("parks budget");
  });
});

describe("filenames + format guard", () => {
  it("slugifies titles", () => {
    expect(slugify("Council Regular Session!")).toBe("council-regular-session");
    expect(slugify("   ")).toBe("transcript");
  });

  it("builds a filename with the format extension", () => {
    expect(exportFilename(diarizedDetail, "md")).toBe("council-regular-session.md");
  });

  it("validates supported formats", () => {
    expect(isExportFormat("txt")).toBe(true);
    expect(isExportFormat("pdf")).toBe(false);
  });
});
