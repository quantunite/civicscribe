// Fixture barrel. Everything mock providers and the seed script need.

import type { DiarizedUtterance } from "@/lib/providers/types";

export { synthesizeWav } from "@/lib/fixtures/audio";
export {
  FIXTURE_COUNCIL_UTTERANCES,
  FIXTURE_COUNCIL_SUMMARY,
} from "@/lib/fixtures/council-meeting";
export {
  FIXTURE_PLANNING_UTTERANCES,
  FIXTURE_PLANNING_SUMMARY,
} from "@/lib/fixtures/planning-meeting";

/**
 * Wrap diarized utterances in an AssemblyAI-response-shaped object, suitable
 * for storing verbatim in transcripts.raw_json. Deterministic for a given
 * utterance list.
 */
export function buildFixtureRawResponse(
  utterances: DiarizedUtterance[]
): unknown {
  const last =
    utterances.length > 0 ? utterances[utterances.length - 1] : undefined;
  return {
    id: `mock-transcript-${utterances.length.toString().padStart(4, "0")}`,
    status: "completed",
    language_code: "en_us",
    audio_duration: last ? Math.round(last.end_ms / 1000) : 0,
    utterances: utterances.map((utterance, index) => ({
      speaker: utterance.speaker_label,
      start: utterance.start_ms,
      end: utterance.end_ms,
      text: utterance.text,
      // Deterministic, plausible per-utterance confidence in [0.92, 0.98].
      confidence: (92 + (index % 7)) / 100,
    })),
    text: utterances.map((utterance) => utterance.text).join(" "),
  };
}
