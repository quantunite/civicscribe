// Caption parsing: json3 + vtt + cue mapping + TranscriptionResult building.

import { describe, expect, it } from "vitest";
import {
  parseJson3,
  parseVtt,
  cuesToUtterances,
  captionResultFromCues,
} from "@/lib/captions/parse";

const JSON3 = JSON.stringify({
  events: [
    {
      tStartMs: 0,
      dDurationMs: 2000,
      segs: [{ utf8: "Good " }, { utf8: "evening." }],
    },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "\n" }] }, // whitespace only -> dropped
    { tStartMs: 2000, dDurationMs: 3000, segs: [{ utf8: "Meeting called to order." }] },
    { tStartMs: 5000, dDurationMs: 1000 }, // no segs -> dropped
  ],
});

const VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
Good evening.

00:00:02.000 --> 00:00:05.000
Meeting <c>called</c> to order.
`;

describe("parseJson3", () => {
  it("extracts non-empty cues with timing", () => {
    expect(parseJson3(JSON3)).toEqual([
      { startMs: 0, endMs: 2000, text: "Good evening." },
      { startMs: 2000, endMs: 5000, text: "Meeting called to order." },
    ]);
  });

  it("returns [] for malformed input", () => {
    expect(parseJson3("not json")).toEqual([]);
    expect(parseJson3(JSON.stringify({ foo: 1 }))).toEqual([]);
  });
});

describe("parseVtt", () => {
  it("extracts cues and strips tags", () => {
    expect(parseVtt(VTT)).toEqual([
      { startMs: 0, endMs: 2000, text: "Good evening." },
      { startMs: 2000, endMs: 5000, text: "Meeting called to order." },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseVtt("")).toEqual([]);
  });
});

describe("cuesToUtterances", () => {
  it("labels every utterance CAPTION and collapses consecutive duplicates", () => {
    expect(
      cuesToUtterances([
        { startMs: 0, endMs: 1000, text: "Hello" },
        { startMs: 1000, endMs: 2000, text: "Hello" },
        { startMs: 2000, endMs: 3000, text: "World" },
      ])
    ).toEqual([
      { speaker_label: "CAPTION", start_ms: 0, end_ms: 2000, text: "Hello" },
      { speaker_label: "CAPTION", start_ms: 2000, end_ms: 3000, text: "World" },
    ]);
  });
});

describe("captionResultFromCues", () => {
  it("builds a non-empty TranscriptionResult with duration from the last cue", () => {
    const r = captionResultFromCues(
      [{ startMs: 0, endMs: 4000, text: "Hi" }],
      "en"
    );
    expect(r).not.toBeNull();
    expect(r!.utterances).toHaveLength(1);
    expect(r!.durationSeconds).toBe(4);
    expect(r!.language).toBe("en");
  });

  it("returns null when there are no usable cues", () => {
    expect(captionResultFromCues([], "en")).toBeNull();
  });
});
