// Mock Recall.ai capture provider. Instant and deterministic: bots are "done"
// immediately, and the downloaded recording is a synthesized WAV tone.

import { synthesizeWav } from "@/lib/fixtures/audio";
import type { BotStatus, CaptureProvider } from "@/lib/providers/types";

const MOCK_RECORDING_SECONDS = 120;

interface MockBot {
  meetingUrl: string;
  meetingId: string;
}

export class MockCaptureProvider implements CaptureProvider {
  private readonly bots = new Map<string, MockBot>();

  async createBot(
    meetingUrl: string,
    meetingId: string,
    opts?: { liveTranscription?: boolean }
  ): Promise<{ botId: string }> {
    void opts; // the mock ignores live transcription; bots still finish instantly
    const botId = `mock-bot-${meetingId}`;
    this.bots.set(botId, { meetingUrl, meetingId });
    return { botId };
  }

  async getBotStatus(botId: string): Promise<{
    status: BotStatus;
    audioUrl?: string;
    error?: string;
  }> {
    // Mock bots finish instantly. Unknown bot ids (e.g. after a dev-server
    // restart) are treated the same so the pipeline never stalls in mock mode.
    return { status: "done", audioUrl: `mock://recording/${botId}` };
  }

  async downloadAudio(
    audioUrl: string
  ): Promise<{ data: Buffer; contentType: string }> {
    void audioUrl; // any mock://recording/* URL yields the same synthetic WAV
    return {
      data: synthesizeWav(MOCK_RECORDING_SECONDS),
      contentType: "audio/wav",
    };
  }
}
