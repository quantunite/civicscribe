// Core domain types for CivicScribe. These mirror the Supabase schema in
// supabase/migrations/ and are the contract shared by the store layer,
// the job pipeline, the providers, and the UI.

export type SourceType = "zoom" | "stream" | "upload";

/** Civic meetings vs. Study Notes educational videos. Drives the
 *  summary prompt + section labels and which dashboard a meeting appears on. */
export type MeetingKind = "civic" | "course";

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
  kind: MeetingKind;
  source_url: string | null;
  status: MeetingStatus;
  error_message: string | null;
  scheduled_at: string | null;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  /** Set when this meeting was materialized by a schedule (null otherwise). */
  schedule_id: string | null;
  /** Per-occurrence idempotency key (the fired next_fire_at); null off-schedule. */
  occurrence_key: string | null;
  /** False until an admin approves it into the public library (Phase 0). */
  published: boolean;
  /** When it was published (null while unpublished). */
  published_at: string | null;
  /** Tenant isolation seed: nullable, defaults to a single tenant for now. */
  tenant_id: string | null;
  /** Normalized dedup key derived from source_url (null when no/odd source). */
  source_key: string | null;
  created_at: string;
}

export interface NewMeeting {
  title: string;
  body_name: string;
  source_type: SourceType;
  /** Defaults to "civic" when omitted. */
  kind?: MeetingKind;
  source_url?: string | null;
  scheduled_at?: string | null;
  audio_storage_path?: string | null;
  schedule_id?: string | null;
  occurrence_key?: string | null;
  /** Optional on create: published defaults to false, tenant_id to null, and
   *  source_key is computed from source_url when omitted. */
  published?: boolean;
  tenant_id?: string | null;
  source_key?: string | null;
}

// --- Scheduled / recurring capture -----------------------------------------

/** Where a schedule's capture URL comes from, resolved at fire time. v1 ships
 *  only fixed_url; channel/playlist resolvers can be added later without a
 *  schema change to the rest of the schedule. */
export type ScheduleSourceSpec = { type: "fixed_url"; url: string };

/** Sources that can be auto-captured (upload cannot be scheduled). */
export type ScheduledSourceType = "zoom" | "stream";

/**
 * A structured recurrence. weekday is 0=Sunday..6=Saturday; time is local
 * "HH:mm" in `timezone` (IANA). weekly fires every `interval` weeks (default 1)
 * on `weekday`; monthly fires the `nth` `weekday` of each month (nth -1 = last).
 */
export type Recurrence =
  | {
      freq: "weekly";
      weekday: number;
      time: string;
      timezone: string;
      interval?: number;
    }
  | {
      freq: "monthly";
      weekday: number;
      nth: number;
      time: string;
      timezone: string;
    };

export interface Schedule {
  id: string;
  title: string;
  body_name: string;
  kind: MeetingKind;
  source_type: ScheduledSourceType;
  source_spec: ScheduleSourceSpec;
  recurrence: Recurrence;
  enabled: boolean;
  /** Next occurrence to fire (ISO instant). The sweep selects next_fire_at <= now. */
  next_fire_at: string;
  last_fired_at: string | null;
  created_at: string;
}

export interface NewSchedule {
  title: string;
  body_name: string;
  kind?: MeetingKind;
  source_type: ScheduledSourceType;
  source_spec: ScheduleSourceSpec;
  recurrence: Recurrence;
  enabled?: boolean;
  /** First fire instant (ISO); compute with firstFireAfter(recurrence, now). */
  next_fire_at: string;
}

/** Fields a schedule update may change. */
export interface ScheduleUpdate {
  title?: string;
  body_name?: string;
  kind?: MeetingKind;
  source_type?: ScheduledSourceType;
  source_spec?: ScheduleSourceSpec;
  recurrence?: Recurrence;
  enabled?: boolean;
  next_fire_at?: string;
  last_fired_at?: string | null;
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

/** One topic bucket for the public /tags browse surface: a canonical display
 *  spelling, its URL slug, and how many published meetings carry it. */
export interface TopicSummary {
  /** Canonical display spelling for the slug (the most common raw topic). */
  topic: string;
  /** URL-safe slug (see topicSlug); the join key for /tags/[slug]. */
  slug: string;
  /** Number of distinct published meetings whose summary carries this topic. */
  count: number;
}

/** A published meeting surfaced on a topic page, with the summary fields a
 *  card needs (the full summary markdown is intentionally omitted). */
export interface TopicMeeting {
  meeting: Meeting;
  overview: string;
  topics: string[];
}

/** A cached cross-meeting synthesis for one topic slug (Phase 3). Built only
 *  from PUBLISHED meetings; regenerated when the published set changes. */
export interface TopicSynthesis {
  slug: string;
  topic: string;
  /** Markdown narrative of how the topic was discussed across the meetings. */
  content: string;
  /** Sorted meeting ids the synthesis was built from (cache-invalidation key). */
  sourceMeetingIds: string[];
  meetingCount: number;
  /** Model that produced the synthesis, or null (column is nullable). */
  model: string | null;
  generatedAt: string;
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
