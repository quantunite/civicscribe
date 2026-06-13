// buildUserContent: diarized transcripts keep "Speaker:" prefixes; caption
// (non-diarized) transcripts are formatted as plain text.

import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  buildUserContent,
} from "@/lib/providers/real/anthropic";

const base = {
  meetingTitle: "Council Meeting",
  bodyName: "City Council",
  utterances: [
    { speaker: "Speaker A", text: "Good evening." },
    { speaker: "Speaker B", text: "Motion to approve." },
  ],
};

describe("buildUserContent", () => {
  it("uses Speaker: prefixes when diarized (default)", () => {
    const out = buildUserContent(base);
    expect(out).toContain("Diarized transcript:");
    expect(out).toContain("Speaker A: Good evening.");
  });

  it("omits speaker prefixes when not diarized", () => {
    const out = buildUserContent({ ...base, diarized: false });
    expect(out).toContain("Transcript (auto-captions, no speaker labels):");
    expect(out).not.toContain("Speaker A:");
    expect(out).toContain("Good evening.");
    expect(out).toContain("Motion to approve.");
  });
});

describe("buildSystemPrompt", () => {
  it("civic uses the civic-meeting summarizer prompt", () => {
    expect(buildSystemPrompt("civic")).toContain("civic meeting summarizer");
  });

  it("course uses the Crash Course study-notes prompt", () => {
    const p = buildSystemPrompt("course");
    expect(p).toContain("Crash Course Corner");
    expect(p).toMatch(/study[- ]notes/i);
    expect(p).toContain("KEY CONCEPT");
  });

  it("undefined defaults to the civic prompt", () => {
    expect(buildSystemPrompt(undefined)).toBe(buildSystemPrompt("civic"));
  });
});
