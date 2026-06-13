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
  MeetingKind,
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
  /** Newest first. Optionally restrict to a single kind (civic vs course). */
  listMeetings(kind?: MeetingKind): Promise<Meeting[]>;
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
  /** Delete a meeting and all of its dependent rows (transcript, utterances,
   *  summary, jobs). A no-op if the meeting does not exist. The caller is
   *  responsible for deleting the audio blob via FileStorage. */
  deleteMeeting(id: string): Promise<void>;

  // -- transcripts & utterances ----------------------------------------------
  /** Create the transcript for a meeting, REPLACING any existing transcript
   *  rows (and their utterances) for that meeting_id. This makes a retried
   *  transcribe stage idempotent: re-running it never leaves duplicate
   *  transcripts or orphaned utterances behind. */
  createTranscript(input: {
    meeting_id: string;
    raw_json: unknown;
    language: string;
    /** Defaults to true (audio transcription). Caption transcripts pass false. */
    diarized?: boolean;
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
  /** Replace a job's payload wholesale (full replace, not a merge). Used to
   *  persist durable stage state (e.g. the Recall bot id) mid-job. */
  updateJobPayload(
    jobId: string,
    payload: Record<string, unknown>
  ): Promise<void>;
  /** Put a job back to "pending" WITHOUT recording a failure: attempts and
   *  last_error are untouched, updated_at is refreshed. Used when external
   *  work (e.g. a Zoom bot still recording) simply isn't finished yet. */
  requeueJob(jobId: string): Promise<void>;
  /** Crash recovery: find jobs stuck in "running" whose updated_at is older
   *  than olderThanMs (the worker's lease expired — the process most likely
   *  died mid-job). Each one is charged a failed attempt (attempts+1,
   *  last_error set) and either requeued to "pending" or, once attempts
   *  reaches MAX_JOB_ATTEMPTS, marked "failed". Returns the updated jobs. */
  reapStaleJobs(olderThanMs: number): Promise<Job[]>;
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
  /** Remove a stored blob. Best-effort: a missing file is not an error. */
  delete(path: string): Promise<void>;
  /** URL the browser can stream audio from (always /api/audio/<path>). */
  publicUrl(path: string): string;
}
