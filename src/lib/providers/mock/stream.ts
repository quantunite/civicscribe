// Mock yt-dlp stream ingest provider. Returns a synthesized WAV instantly, and
// a fixture caption transcript from fetchCaptions (unless the URL opts out).

import { synthesizeWav } from "@/lib/fixtures/audio";
import { buildFixtureCaptionResult } from "@/lib/fixtures/captions";
import type {
  StreamIngestProvider,
  TranscriptionResult,
} from "@/lib/providers/types";

const MOCK_STREAM_SECONDS = 120;

export class MockStreamIngestProvider implements StreamIngestProvider {
  async fetchCaptions(streamUrl: string): Promise<TranscriptionResult | null> {
    // A URL containing "nocaptions" exercises the audio fallback path.
    if (streamUrl.includes("nocaptions")) return null;
    return buildFixtureCaptionResult();
  }

  async extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }> {
    void streamUrl; // every URL yields the same deterministic synthetic audio
    return {
      data: synthesizeWav(MOCK_STREAM_SECONDS),
      contentType: "audio/wav",
      durationSeconds: MOCK_STREAM_SECONDS,
    };
  }
}
