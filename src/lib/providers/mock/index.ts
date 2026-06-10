// Mock provider factory. MOCK_MODE=true routes here via getProviders().
// Every mock is instant and deterministic so the e2e suite can run the full
// submit -> capture -> transcribe -> summarize -> notify pipeline offline.

import type { Providers } from "@/lib/providers/types";
import { MockCaptureProvider } from "@/lib/providers/mock/capture";
import { MockStreamIngestProvider } from "@/lib/providers/mock/stream";
import { MockTranscriptionProvider } from "@/lib/providers/mock/transcription";
import { MockSummaryProvider } from "@/lib/providers/mock/summary";
import { MockEmailProvider } from "@/lib/providers/mock/email";

export function createMockProviders(): Providers {
  return {
    capture: new MockCaptureProvider(),
    streamIngest: new MockStreamIngestProvider(),
    transcription: new MockTranscriptionProvider(),
    summary: new MockSummaryProvider(),
    email: new MockEmailProvider(),
  };
}
