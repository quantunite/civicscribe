// Deterministic caption fixture used by the mock stream provider and tests.

import { captionResultFromCues, type CaptionCue } from "@/lib/captions/parse";
import type { TranscriptionResult } from "@/lib/providers/types";

export const FIXTURE_CAPTION_CUES: CaptionCue[] = [
  {
    startMs: 0,
    endMs: 4000,
    text: "Good evening and welcome to the regular meeting of the City Council.",
  },
  {
    startMs: 4000,
    endMs: 9000,
    text: "The first item on the agenda is the proposed parks budget for next year.",
  },
  {
    startMs: 9000,
    endMs: 15000,
    text: "After discussion, the council voted four to one to approve the budget as presented.",
  },
  {
    startMs: 15000,
    endMs: 20000,
    text: "The meeting was adjourned at eight fifteen p.m.",
  },
];

export function buildFixtureCaptionResult(): TranscriptionResult {
  // Non-null by construction (the fixture always has cues).
  return captionResultFromCues(FIXTURE_CAPTION_CUES, "en")!;
}
