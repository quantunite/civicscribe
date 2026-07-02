// Core domain types for CivicScribe. These mirror the Supabase schema in
// supabase/migrations/ and are the contract shared by the store layer,
// the job pipeline, the providers, and the UI.

export type SourceType = "zoom" | "teams" | "meet" | "stream" | "upload";

/** Civic meetings vs. Study Notes educational videos. Drives the
 *  summary prompt + section labels and which dashboard a meeting appears on. */
export type MeetingKind = "civic" | "course";

/** The lawful basis the submitter affirmed when submitting a meeting for
 *  self-serve recording: "public" = an open meeting of a public body;
 *  "authorized" = the submitter has explicit authority to record it and add it
 *  to the public library. Stored as an audit trail. Null on legacy/server-seeded
 *  rows that predate the attestation gate. */
export type MeetingAttestation = "public" | "authorized";

export type MeetingStatus =
  | "pending"
  | "capturing"
  | "transcribing"
  | "summarizing"
  | "complete"
  | "failed";

// -- users (auth) -----------------------------------------------------------
/** Account roles. All three are defined now; only `admin` is issued in the
 *  Phase 1 identity core. `moderator` and `user` are reserved for later phases
 *  (staff roles + public signup). Mirrors the role union in lib/auth/session. */
export type UserRole = "admin" | "moderator" | "user";

export interface User {
  id: string;
  /** Stored lowercased; uniqueness enforced on lower(email). */
  email: string;
  password_hash: string;
  role: UserRole;
  name: string | null;
  created_at: string;
}

export interface NewUser {
  email: string;
  password_hash: string;
  role?: UserRole;
  name?: string | null;
}

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
  /** The lawful basis the submitter affirmed at create time (self-serve gate).
   *  Null on rows created before the attestation gate (or server-seeded). */
  attestation: MeetingAttestation | null;
  /** Binding clickwrap attestation captured at submit time (migration 0015):
   *  the submitter checked the required box affirming they are authorized to
   *  record this meeting AND agreed to the Terms + Privacy Policy. False on
   *  legacy / server-seeded / scheduled rows that carry no submitter agreement. */
  terms_agreed: boolean;
  /** Server timestamp the clickwrap agreement was recorded (null until agreed). */
  terms_agreed_at: string | null;
  /** Version of the Terms + Privacy in force when the submitter agreed
   *  (see lib/legal.ts TERMS_VERSION). Null until an agreement is recorded. */
  terms_version: string | null;
  /** When the submitter asked to add this to the public record (the "Add to the
   *  public record" action on the self-serve result page). Null until requested;
   *  publication still requires staff approval. */
  publish_requested_at: string | null;
  /** False until an admin approves it into the public library (Phase 0). */
  published: boolean;
  /** When it was published (null while unpublished). */
  published_at: string | null;
  /** Tenant isolation seed: nullable, defaults to a single tenant for now. */
  tenant_id: string | null;
  /** Normalized dedup key derived from source_url (null when no/odd source). */
  source_key: string | null;
  /** Opt-in per meeting (bot sources only). When true, the Recall bot streams a
   *  real-time transcript to the webhook and a public /meetings/[id]/live page
   *  follows it. Defaults false; nothing changes for existing meetings. */
  live_enabled: boolean;
  /** Set when the first live utterance arrives (null until then). */
  live_started_at: string | null;
  /** Set when the bot finishes capturing (null while live or never live). */
  live_ended_at: string | null;
  /** Rolling "here's what you missed" recap of the live transcript, kept current
   *  while the meeting is captured and served to all live viewers. Null until a
   *  live meeting accrues lines and a viewer triggers the first generation. */
  live_summary: string | null;
  /** Highest live_utterance id the rolling recap has covered (null until then).
   *  The next refresh feeds only lines past this id to the LLM, bounding input. */
  live_summary_through_id: number | null;
  /** When the rolling recap was last (re)generated; gates the ~120s refresh. */
  live_summary_at: string | null;
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
  /** The lawful basis the submitter affirmed (self-serve gate). Defaults to null
   *  for server-seeded/scheduled rows that carry no submitter attestation. */
  attestation?: MeetingAttestation | null;
  /** Binding clickwrap agreement captured at submit time. Defaults to
   *  false/null for server-seeded / scheduled rows that carry no agreement.
   *  The public submit routes set all three together at create time. */
  terms_agreed?: boolean;
  terms_agreed_at?: string | null;
  terms_version?: string | null;
  /** Optional on create: published defaults to false, tenant_id to null, and
   *  source_key is computed from source_url when omitted. */
  published?: boolean;
  tenant_id?: string | null;
  source_key?: string | null;
  /** Opt-in live captions (bot sources only). Defaults false. */
  live_enabled?: boolean;
}

// --- Scheduled / recurring capture -----------------------------------------

/** Where a schedule's capture URL comes from, resolved at fire time. v1 ships
 *  only fixed_url; channel/playlist resolvers can be added later without a
 *  schema change to the rest of the schedule. */
export type ScheduleSourceSpec = { type: "fixed_url"; url: string };

/** Sources that can be auto-captured (upload cannot be scheduled). */
export type ScheduledSourceType = "zoom" | "teams" | "meet" | "stream";

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
  /** Null for a one-off (recurrence is meaningless); set for a recurring schedule. */
  recurrence: Recurrence | null;
  /** True for a single future capture: it fires once then the sweep disables it. */
  one_off: boolean;
  enabled: boolean;
  /** Next occurrence to fire (ISO instant). The sweep selects next_fire_at <= now. */
  next_fire_at: string;
  last_fired_at: string | null;
  /** Created meetings inherit this (bot sources only). Defaults false. */
  live_enabled: boolean;
  created_at: string;
}

export interface NewSchedule {
  title: string;
  body_name: string;
  kind?: MeetingKind;
  source_type: ScheduledSourceType;
  source_spec: ScheduleSourceSpec;
  /** Null for a one-off; the recurrence for a recurring schedule. */
  recurrence: Recurrence | null;
  /** Defaults to false (recurring). Pass true for a one-off single capture. */
  one_off?: boolean;
  enabled?: boolean;
  /** Fire instant (ISO). Recurring: firstFireAfter(recurrence, now). One-off:
   *  the chosen future instant the capture should run at. */
  next_fire_at: string;
  /** Live captions for materialized meetings (bot sources only). Defaults false. */
  live_enabled?: boolean;
}

/** Fields a schedule update may change. */
export interface ScheduleUpdate {
  title?: string;
  body_name?: string;
  kind?: MeetingKind;
  source_type?: ScheduledSourceType;
  source_spec?: ScheduleSourceSpec;
  /** May be set to null to clear a recurrence (e.g. converting kinds). */
  recurrence?: Recurrence | null;
  one_off?: boolean;
  enabled?: boolean;
  next_fire_at?: string;
  last_fired_at?: string | null;
  live_enabled?: boolean;
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

/** One finalized live-transcript line, ingested from a Recall real-time
 *  transcript.data event while a bot is in the call. Separate from the batch
 *  Utterance: provisional, polled by the public live page, and replaced by the
 *  authoritative diarized transcript after the meeting ends. */
export interface LiveUtterance {
  id: number;
  meeting_id: string;
  speaker_label: string | null;
  text: string;
  ts_seconds: number | null;
  created_at: string;
}

export interface NewLiveUtterance {
  speaker_label?: string | null;
  text: string;
  ts_seconds?: number | null;
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
