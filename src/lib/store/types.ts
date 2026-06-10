// Data-layer contracts. Two DataStore implementations exist:
//  - MemoryStore (src/lib/store/memory.ts): file-backed JSON store used in
//    MOCK_MODE (or when SUPABASE_URL is unset) so the app runs end-to-end with
//    zero external services. State persists to {dataDir}/db.json.
//  - SupabaseStore (src/lib/store/supabase.ts): production implementation over
//    the schema in supabase/migrations/, using claim_next_job() (FOR UPDATE
//    SKIP LOCKED) for job claiming.
// FileStorage likewise has a local-disk and a Supabase Storage implementation.
// Audio is always served to the browser through /api/audio/[...path] so both
// backends present the same URL shape.

import type {
  Job,
  JobType,
  Meeting,
  MeetingStatus,
  NewMeeting,
  NewUtterance,
  SpeakerAlias,
  Summary,
  Transcript,
  Utterance,
  UtteranceSearchResult,
  MeetingSummaryContent,
} from "@/lib/types";

export interface DataStore {
  // -- meetings -------------------------------------------------------------
  createMeeting(input: NewMeeting): Promise<Meeting>;
  getMeeting(id: string): Promise<Meeting | null>;
  /** Newest first. */
  listMeetings(): Promise<Meeting[]>;
  updateMeeting(
    id: string,
    patch: Partial<
      Pick<
        Meeting,
        | "status"
        | "error_message"
        | "audio_storage_path"
        | "duration_seconds"
        | "title"
      >
    >
  ): Promise<Meeting>;
  setMeetingStatus(
    id: string,
    status: MeetingStatus,
    errorMessage?: string | null
  ): Promise<void>;

  // -- transcripts & utterances ----------------------------------------------
  createTranscript(input: {
    meeting_id: string;
    raw_json: unknown;
    language: string;
  }): Promise<Transcript>;
  getTranscriptByMeeting(meetingId: string): Promise<Transcript | null>;
  createUtterances(
    transcriptId: string,
    utterances: NewUtterance[]
  ): Promise<void>;
  /** Ordered by start_ms ascending. */
  listUtterances(transcriptId: string): Promise<Utterance[]>;
  updateUtteranceSpeakerName(
    utteranceId: string,
    speakerName: string
  ): Promise<Utterance>;
  /** Set speaker_name on every utterance in a transcript with the given label.
   *  Returns the number of utterances updated. */
  applySpeakerNameToLabel(
    transcriptId: string,
    speakerLabel: string,
    speakerName: string
  ): Promise<number>;

  // -- summaries --------------------------------------------------------------
  createSummary(
    meetingId: string,
    content: MeetingSummaryContent
  ): Promise<Summary>;
  getSummaryByMeeting(meetingId: string): Promise<Summary | null>;

  // -- speaker aliases ---------------------------------------------------------
  upsertSpeakerAlias(input: {
    body_name: string;
    speaker_label_pattern: string;
    display_name: string;
  }): Promise<SpeakerAlias>;
  listSpeakerAliases(bodyName?: string): Promise<SpeakerAlias[]>;

  // -- jobs ---------------------------------------------------------------------
  enqueueJob(
    meetingId: string,
    type: JobType,
    payload?: Record<string, unknown>
  ): Promise<Job>;
  /** Atomically claim one pending job (oldest first) and mark it running.
   *  Returns null when no pending job exists. Supabase impl uses
   *  SELECT ... FOR UPDATE SKIP LOCKED via the claim_next_job() RPC. */
  claimNextJob(): Promise<Job | null>;
  completeJob(jobId: string): Promise<void>;
  /** Record a failed attempt. Increments attempts and either requeues the job
   *  (status back to pending) or, when attempts >= MAX_JOB_ATTEMPTS, marks it
   *  failed. Returns the updated job. */
  failJob(jobId: string, error: string): Promise<Job>;
  getJobsByMeeting(meetingId: string): Promise<Job[]>;

  // -- search ---------------------------------------------------------------------
  /** Full-text search across utterances. When meetingId is given, restrict to
   *  that meeting. Newest meetings first, then by start_ms. */
  searchUtterances(
    query: string,
    opts?: { meetingId?: string; limit?: number }
  ): Promise<UtteranceSearchResult[]>;
}

export interface FileStorage {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ data: Buffer; contentType: string } | null>;
  /** URL the browser can stream audio from (always /api/audio/<path>). */
  publicUrl(path: string): string;
}
