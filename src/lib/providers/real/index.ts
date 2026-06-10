// Real provider factory — used when MOCK_MODE is not "true".
// Each provider reads its API key from the AppConfig passed in and throws a
// clear, actionable error at call time (not construction time) if the key is
// missing, so the app still boots with a partial set of keys.

import type { AppConfig } from "@/lib/config";
import type { Providers } from "@/lib/providers/types";
import { AnthropicSummaryProvider } from "@/lib/providers/real/anthropic";
import { AssemblyAiTranscriptionProvider } from "@/lib/providers/real/assemblyai";
import { RecallCaptureProvider } from "@/lib/providers/real/recall";
import { ResendEmailProvider } from "@/lib/providers/real/resend";
import { YtDlpStreamIngestProvider } from "@/lib/providers/real/ytdlp";

export function createRealProviders(config: AppConfig): Providers {
  return {
    capture: new RecallCaptureProvider(config),
    streamIngest: new YtDlpStreamIngestProvider(),
    transcription: new AssemblyAiTranscriptionProvider(config),
    summary: new AnthropicSummaryProvider(config),
    email: new ResendEmailProvider(config),
  };
}
