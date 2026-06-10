// Sanity checks on the council-meeting fixture that the whole MOCK_MODE
// pipeline (mock transcription provider, seed script, e2e test) depends on.

import { describe, expect, it } from "vitest";

import {
  FIXTURE_COUNCIL_UTTERANCES,
  buildFixtureRawResponse,
} from "@/lib/fixtures";

describe("FIXTURE_COUNCIL_UTTERANCES", () => {
  it("has at least 40 utterances", () => {
    expect(FIXTURE_COUNCIL_UTTERANCES.length).toBeGreaterThanOrEqual(40);
  });

  it("has exactly 4 distinct speaker labels", () => {
    const labels = new Set(
      FIXTURE_COUNCIL_UTTERANCES.map((u) => u.speaker_label)
    );
    expect(labels.size).toBe(4);
    expect([...labels].sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("has strictly increasing start_ms and end_ms > start_ms throughout", () => {
    let prevStart = -1;
    for (const [i, u] of FIXTURE_COUNCIL_UTTERANCES.entries()) {
      expect(u.start_ms, `utterance ${i} start_ms`).toBeGreaterThan(prevStart);
      expect(u.end_ms, `utterance ${i} end_ms`).toBeGreaterThan(u.start_ms);
      prevStart = u.start_ms;
    }
  });

  it("has non-empty text on every utterance", () => {
    for (const u of FIXTURE_COUNCIL_UTTERANCES) {
      expect(u.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("buildFixtureRawResponse", () => {
  it("wraps utterances in an AssemblyAI-shaped completed response", () => {
    const raw = buildFixtureRawResponse(FIXTURE_COUNCIL_UTTERANCES) as {
      status: string;
      audio_duration: number;
      utterances: Array<{
        speaker: string;
        start: number;
        end: number;
        text: string;
      }>;
      text: string;
    };

    expect(raw.status).toBe("completed");
    expect(raw.utterances).toHaveLength(FIXTURE_COUNCIL_UTTERANCES.length);

    const last =
      FIXTURE_COUNCIL_UTTERANCES[FIXTURE_COUNCIL_UTTERANCES.length - 1];
    expect(raw.audio_duration).toBe(Math.round(last.end_ms / 1000));

    // Field mapping matches the AssemblyAI wire shape.
    const first = raw.utterances[0];
    expect(first.speaker).toBe(FIXTURE_COUNCIL_UTTERANCES[0].speaker_label);
    expect(first.start).toBe(FIXTURE_COUNCIL_UTTERANCES[0].start_ms);
    expect(first.end).toBe(FIXTURE_COUNCIL_UTTERANCES[0].end_ms);
    expect(first.text).toBe(FIXTURE_COUNCIL_UTTERANCES[0].text);
  });
});
