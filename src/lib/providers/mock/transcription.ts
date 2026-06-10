// Mock AssemblyAI transcription provider. Always returns the fixture council
// meeting transcript, instantly, regardless of the audio supplied.

import {
  FIXTURE_COUNCIL_UTTERANCES,
  buildFixtureRawResponse,
} from "@/lib/fixtures";
import type {
  AudioSource,
  DiarizedUtterance,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/lib/providers/types";

export class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribe(audio: AudioSource): Promise<TranscriptionResult> {
    void audio; // mock ignores the actual audio bytes/url
    // Clone so downstream consumers can never mutate the shared fixture.
    const utterances: DiarizedUtterance[] = FIXTURE_COUNCIL_UTTERANCES.map(
      (utterance) => ({ ...utterance })
    );
    const last =
      utterances.length > 0 ? utterances[utterances.length - 1] : undefined;
    return {
      rawJson: buildFixtureRawResponse(utterances),
      language: "en",
      durationSeconds: last ? Math.round(last.end_ms / 1000) : 0,
      utterances,
    };
  }
}
