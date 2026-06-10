// Provider interfaces. Every external service sits behind one of these.
// Each has a `real` implementation (src/lib/providers/real/) and a `mock`
// implementation (src/lib/providers/mock/). MOCK_MODE=true switches all
// providers to mocks via getProviders() in src/lib/providers/index.ts.

import type { Meeting, MeetingSummaryContent, Summary } from "@/lib/types";

/** Audio handed between pipeline stages: either raw bytes or a fetchable URL. */
export type AudioSource =
  | { kind: "bytes"; data: Buffer; contentType: string }
  | { kind: "url"; url: string };

// ---------------------------------------------------------------------------
// Recall.ai — Zoom meeting capture via a bot.

export type BotStatus = "joining" | "recording" | "done" | "failed";

export interface CaptureProvider {
  /** Create a bot that joins the given Zoom meeting URL. Returns the bot id. */
  createBot(meetingUrl: string, meetingId: string): Promise<{ botId: string }>;
  /** Poll bot state. When status is "done", audioUrl points at the recording. */
  getBotStatus(botId: string): Promise<{
    status: BotStatus;
    audioUrl?: string;
    error?: string;
  }>;
  /** Download the finished recording. */
  downloadAudio(audioUrl: string): Promise<{ data: Buffer; contentType: string }>;
}

// ---------------------------------------------------------------------------
// yt-dlp — public stream audio extraction.

export interface StreamIngestProvider {
  /** Extract audio from a public stream/video URL. Returns audio bytes. */
  extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// AssemblyAI — transcription + diarization in one call.

export interface DiarizedUtterance {
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranscriptionResult {
  /** Full provider response, stored verbatim in transcripts.raw_json. */
  rawJson: unknown;
  language: string;
  durationSeconds: number | null;
  utterances: DiarizedUtterance[];
}

export interface TranscriptionProvider {
  transcribe(audio: AudioSource): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// Anthropic — structured meeting summary.

export interface SummaryInput {
  meetingTitle: string;
  bodyName: string;
  utterances: Array<{ speaker: string; text: string }>;
}

export interface SummaryProvider {
  summarize(input: SummaryInput): Promise<MeetingSummaryContent>;
}

// ---------------------------------------------------------------------------
// Resend — completion email (stubbed: log to console in dev).

export interface EmailProvider {
  sendCompletionEmail(
    to: string,
    meeting: Meeting,
    summary: Summary | null
  ): Promise<void>;
}

// ---------------------------------------------------------------------------

export interface Providers {
  capture: CaptureProvider;
  streamIngest: StreamIngestProvider;
  transcription: TranscriptionProvider;
  summary: SummaryProvider;
  email: EmailProvider;
}
