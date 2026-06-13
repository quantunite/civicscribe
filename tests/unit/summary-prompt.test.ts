// buildUserContent: diarized transcripts keep "Speaker:" prefixes; caption
// (non-diarized) transcripts are formatted as plain text.

import { describe, expect, it } from "vitest";
import { buildUserContent } from "@/lib/providers/real/anthropic";

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
