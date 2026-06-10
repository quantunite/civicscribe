// Mock yt-dlp stream ingest provider. Returns a synthesized WAV instantly.

import { synthesizeWav } from "@/lib/fixtures/audio";
import type { StreamIngestProvider } from "@/lib/providers/types";

const MOCK_STREAM_SECONDS = 120;

export class MockStreamIngestProvider implements StreamIngestProvider {
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
