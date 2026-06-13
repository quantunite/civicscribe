// Core domain types for CivicScribe. These mirror the Supabase schema in
// supabase/migrations/ and are the contract shared by the store layer,
// the job pipeline, the providers, and the UI.

export type SourceType = "zoom" | "stream" | "upload";

export type MeetingStatus =
  | "pending"
  | "capturing"
  | "transcribing"
  | "summarizing"
  | "complete"
  | "failed";

export interface Meeting {
  id: string;
  title: string;
  body_name: string;
  source_type: SourceType;
  source_url: string | null;
  status: MeetingStatus;
  error_message: string | null;
  scheduled_at: string | null;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface NewMeeting {
  title: string;
  body_name: string;
  source_type: SourceType;
  source_url?: string | null;
  scheduled_at?: string | null;
  audio_storage_path?: string | null;
}

export interface Transcript {
  id: string;
  meeting_id: string;
  raw_json: unknown;
  language: string;
  /** True for audio transcription (AssemblyAI/mock — has speaker labels);
   *  false for caption-sourced transcripts (caption fast lane, no diarization). */
  diarized: boolean;
  created_at: string;
}

export interface Utterance {
  id: string;
  transcript_id: string;
  speaker_label: string;
  speaker_name: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface NewUtterance {
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Summary {
  id: string;
  meeting_id: string;
  overview: string;
  key_decisions: string[];
  action_items: string[];
  topics: string[];
  full_markdown: string;
}

export interface SpeakerAlias {
  id: string;
  body_name: string;
  speaker_label_pattern: string;
  display_name: string;
}

export type JobType = "capture" | "transcribe" | "summarize" | "notify";
export type JobStatus = "pending" | "running" | "complete" | "failed";

export const MAX_JOB_ATTEMPTS = 3;

export interface Job {
  id: string;
  meeting_id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UtteranceSearchResult {
  utterance: Utterance;
  meeting: Pick<Meeting, "id" | "title" | "body_name" | "created_at">;
}

/** The structured summary shape returned by the SummaryProvider. */
export interface MeetingSummaryContent {
  overview: string;
  key_decisions: string[];
  action_items: string[];
  topics: string[];
  full_markdown: string;
}

/** Everything the meeting detail page needs in one fetch. */
export interface MeetingDetail {
  meeting: Meeting;
  transcript: Transcript | null;
  utterances: Utterance[];
  summary: Summary | null;
}
