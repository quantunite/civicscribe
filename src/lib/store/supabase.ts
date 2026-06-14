// Production persistence layer over Supabase (Postgres + Storage).
//
// SupabaseStore maps every DataStore method onto the schema defined in
// supabase/migrations/0001_init.sql, using the service-role key (server-only —
// never expose this client to the browser). Job claiming goes through the
// claim_next_job() RPC, which uses SELECT ... FOR UPDATE SKIP LOCKED so
// concurrent workers can never double-claim.
//
// SupabaseFileStorage stores audio in the private "meeting-audio" bucket.
// publicUrl still returns "/api/audio/<path>": the Next.js audio route streams
// the file server-side via get(), so the browser-facing URL shape matches the
// local-disk implementation exactly.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AppConfig } from "@/lib/config";
import {
  MAX_JOB_ATTEMPTS,
  type Job,
  type JobStatus,
  type JobType,
  type Meeting,
  type MeetingStatus,
  type MeetingSummaryContent,
  type NewMeeting,
  type NewSchedule,
  type NewUtterance,
  type Recurrence,
  type Schedule,
  type ScheduleSourceSpec,
  type ScheduleUpdate,
  type ScheduledSourceType,
  type SourceType,
  type MeetingKind,
  type SpeakerAlias,
  type Summary,
  type Transcript,
  type Utterance,
  type UtteranceSearchResult,
} from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";
import { orderSearchResults } from "@/lib/store/search-order";
import { sourceKey } from "@/lib/net/source-key";

// ---------------------------------------------------------------------------
// Local row types (no generated Supabase types available). Enum-ish columns
// are typed with the domain unions directly — the DB CHECK constraints
// guarantee them — which keeps casts narrow and single-purpose.

interface MeetingRow {
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
  schedule_id: string | null;
  occurrence_key: string | null;
  published: boolean;
  published_at: string | null;
  tenant_id: string | null;
  source_key: string | null;
  created_at: string;
}

interface ScheduleRow {
  id: string;
  title: string;
  body_name: string;
  kind: MeetingKind;
  source_type: ScheduledSourceType;
  source_spec: unknown;
  recurrence: unknown;
  enabled: boolean;
  next_fire_at: string;
  last_fired_at: string | null;
  created_at: string;
}

interface TranscriptRow {
  id: string;
  meeting_id: string;
  raw_json: unknown;
  language: string;
  diarized: boolean;
  created_at: string;
}

interface UtteranceRow {
  id: string;
  transcript_id: string;
  speaker_label: string;
  speaker_name: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface SummaryRow {
  id: string;
  meeting_id: string;
  overview: string;
  key_decisions: unknown;
  action_items: unknown;
  topics: unknown;
  full_markdown: string;
}

interface SpeakerAliasRow {
  id: string;
  body_name: string;
  speaker_label_pattern: string;
  display_name: string;
}

interface JobRow {
  id: string;
  meeting_id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// mapping helpers

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    body_name: row.body_name,
    source_type: row.source_type,
    kind: row.kind ?? "civic",
    source_url: row.source_url,
    status: row.status,
    error_message: row.error_message,
    scheduled_at: row.scheduled_at,
    audio_storage_path: row.audio_storage_path,
    duration_seconds: row.duration_seconds,
    schedule_id: row.schedule_id ?? null,
    occurrence_key: row.occurrence_key ?? null,
    published: row.published ?? false,
    published_at: row.published_at ?? null,
    tenant_id: row.tenant_id ?? null,
    source_key: row.source_key ?? null,
    created_at: row.created_at,
  };
}

function mapSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    title: row.title,
    body_name: row.body_name,
    kind: row.kind ?? "civic",
    source_type: row.source_type,
    source_spec: row.source_spec as ScheduleSourceSpec,
    recurrence: row.recurrence as Recurrence,
    enabled: row.enabled,
    next_fire_at: row.next_fire_at,
    last_fired_at: row.last_fired_at,
    created_at: row.created_at,
  };
}

function mapTranscript(row: TranscriptRow): Transcript {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    raw_json: row.raw_json,
    language: row.language,
    diarized: row.diarized ?? true,
    created_at: row.created_at,
  };
}

function mapUtterance(row: UtteranceRow): Utterance {
  return {
    id: row.id,
    transcript_id: row.transcript_id,
    speaker_label: row.speaker_label,
    speaker_name: row.speaker_name,
    start_ms: row.start_ms,
    end_ms: row.end_ms,
    text: row.text,
  };
}

function mapSummary(row: SummaryRow): Summary {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    overview: row.overview,
    key_decisions: toStringArray(row.key_decisions),
    action_items: toStringArray(row.action_items),
    topics: toStringArray(row.topics),
    full_markdown: row.full_markdown,
  };
}

function mapAlias(row: SpeakerAliasRow): SpeakerAlias {
  return {
    id: row.id,
    body_name: row.body_name,
    speaker_label_pattern: row.speaker_label_pattern,
    display_name: row.display_name,
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    last_error: row.last_error,
    payload: toRecord(row.payload),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fail(op: string, error: { message: string }): never {
  throw new Error(`Supabase ${op} failed: ${error.message}`);
}

/** A Postgres unique-violation (SQLSTATE 23505) surfaced by PostgREST. Used by
 *  the createMeeting source_key race backstop. */
function isUniqueViolation(error: { code?: string | null }): boolean {
  return error.code === "23505";
}

function makeClient(config: AppConfig, who: string): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      `${who} requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set ` +
        "(or run with MOCK_MODE=true to use the local store)"
    );
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeKey(storagePath: string): string {
  return storagePath.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// SupabaseStore

export class SupabaseStore implements DataStore {
  private readonly client: SupabaseClient;

  constructor(config: AppConfig) {
    this.client = makeClient(config, "SupabaseStore");
  }

  // -- meetings -------------------------------------------------------------

  async createMeeting(input: NewMeeting): Promise<Meeting> {
    // Compute the dedup key from source_url unless one was passed explicitly.
    const key =
      input.source_key !== undefined
        ? input.source_key
        : sourceKey(input.source_url);

    const { data, error } = await this.client
      .from("meetings")
      .insert({
        title: input.title,
        body_name: input.body_name,
        source_type: input.source_type,
        kind: input.kind ?? "civic",
        source_url: input.source_url ?? null,
        scheduled_at: input.scheduled_at ?? null,
        audio_storage_path: input.audio_storage_path ?? null,
        schedule_id: input.schedule_id ?? null,
        occurrence_key: input.occurrence_key ?? null,
        // published / published_at / tenant_id keep their column defaults
        // (false / null / null) unless an admin promotes the row later.
        published: input.published ?? false,
        tenant_id: input.tenant_id ?? null,
        source_key: key,
      })
      .select()
      .single();

    // Race backstop: two concurrent identical submits both pass the route's
    // check-then-create dedup, but the partial UNIQUE index on source_key
    // (migration 0006) lets only one insert win. The loser gets a 23505 unique
    // violation; re-read by source_key and return the winner's row so the
    // public POST still surfaces { duplicate: true, meeting } instead of erroring
    // (and we never double-spend on generation).
    if (error) {
      if (isUniqueViolation(error) && key) {
        const existing = await this.findBySourceKey(key);
        if (existing) return existing;
      }
      fail("createMeeting", error);
    }
    return mapMeeting(data as MeetingRow);
  }

  async getMeetingByOccurrence(
    scheduleId: string,
    occurrenceKey: string
  ): Promise<Meeting | null> {
    const { data, error } = await this.client
      .from("meetings")
      .select("*")
      .eq("schedule_id", scheduleId)
      .eq("occurrence_key", occurrenceKey)
      .maybeSingle();
    if (error) fail("getMeetingByOccurrence", error);
    return data ? mapMeeting(data as MeetingRow) : null;
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    const { data, error } = await this.client
      .from("meetings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("getMeeting", error);
    return data ? mapMeeting(data as MeetingRow) : null;
  }

  async listMeetings(kind?: MeetingKind): Promise<Meeting[]> {
    let query = this.client
      .from("meetings")
      .select("*")
      .order("created_at", { ascending: false });
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) fail("listMeetings", error);
    return ((data ?? []) as MeetingRow[]).map(mapMeeting);
  }

  async listLibrary(opts?: { kind?: MeetingKind }): Promise<Meeting[]> {
    let query = this.client
      .from("meetings")
      .select("*")
      .eq("published", true)
      .order("created_at", { ascending: false });
    if (opts?.kind) query = query.eq("kind", opts.kind);
    const { data, error } = await query;
    if (error) fail("listLibrary", error);
    return ((data ?? []) as MeetingRow[]).map(mapMeeting);
  }

  async listPendingReview(): Promise<Meeting[]> {
    const { data, error } = await this.client
      .from("meetings")
      .select("*")
      // Secondary order by id keeps created_at ties deterministic, matching
      // MemoryStore's insertion-order tiebreak.
      .eq("published", false)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) fail("listPendingReview", error);
    return ((data ?? []) as MeetingRow[]).map(mapMeeting);
  }

  async findBySourceKey(key: string | null): Promise<Meeting | null> {
    if (!key) return null;
    const { data, error } = await this.client
      .from("meetings")
      .select("*")
      .eq("source_key", key)
      // Secondary order by id breaks created_at ties deterministically so the
      // "newest match wins" choice matches MemoryStore's insertion-order tiebreak.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("findBySourceKey", error);
    return data ? mapMeeting(data as MeetingRow) : null;
  }

  async publishMeeting(id: string): Promise<Meeting> {
    // Idempotent: keep the original published_at on a re-publish. Read first so
    // an already-published row is returned unchanged.
    const existing = await this.getMeeting(id);
    if (!existing) throw new Error(`Meeting not found: ${id}`);
    if (existing.published) return existing;

    const { data, error } = await this.client
      .from("meetings")
      .update({ published: true, published_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) fail("publishMeeting", error);
    return mapMeeting(data as MeetingRow);
  }

  async unpublishMeeting(id: string): Promise<Meeting> {
    const existing = await this.getMeeting(id);
    if (!existing) throw new Error(`Meeting not found: ${id}`);

    const { data, error } = await this.client
      .from("meetings")
      .update({ published: false, published_at: null })
      .eq("id", id)
      .select()
      .single();
    if (error) fail("unpublishMeeting", error);
    return mapMeeting(data as MeetingRow);
  }

  async updateMeeting(
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
  ): Promise<Meeting> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.error_message !== undefined)
      update.error_message = patch.error_message;
    if (patch.audio_storage_path !== undefined)
      update.audio_storage_path = patch.audio_storage_path;
    if (patch.duration_seconds !== undefined)
      update.duration_seconds = patch.duration_seconds;
    if (patch.title !== undefined) update.title = patch.title;

    if (Object.keys(update).length === 0) {
      const existing = await this.getMeeting(id);
      if (!existing) throw new Error(`Meeting not found: ${id}`);
      return existing;
    }

    const { data, error } = await this.client
      .from("meetings")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) fail("updateMeeting", error);
    return mapMeeting(data as MeetingRow);
  }

  async setMeetingStatus(
    id: string,
    status: MeetingStatus,
    errorMessage?: string | null
  ): Promise<void> {
    const { error } = await this.client
      .from("meetings")
      .update({ status, error_message: errorMessage ?? null })
      .eq("id", id);
    if (error) fail("setMeetingStatus", error);
  }

  async deleteMeeting(id: string): Promise<void> {
    // transcripts, utterances, summaries, and jobs are all FK'd to meetings
    // with ON DELETE CASCADE (see 0001_init.sql), so deleting the meeting row
    // removes every dependent row.
    const { error } = await this.client
      .from("meetings")
      .delete()
      .eq("id", id);
    if (error) fail("deleteMeeting", error);
  }

  // -- transcripts & utterances ----------------------------------------------

  async createTranscript(input: {
    meeting_id: string;
    raw_json: unknown;
    language: string;
    diarized?: boolean;
  }): Promise<Transcript> {
    // Replace semantics: drop any existing transcript rows (and their
    // utterances) for this meeting first, so a retried transcribe stage is
    // idempotent and never leaves duplicates or orphans behind.
    const { data: existing, error: readError } = await this.client
      .from("transcripts")
      .select("id")
      .eq("meeting_id", input.meeting_id);
    if (readError) fail("createTranscript (read existing)", readError);
    const staleIds = ((existing ?? []) as Array<{ id: string }>).map(
      (t) => t.id
    );
    if (staleIds.length > 0) {
      const { error: uError } = await this.client
        .from("utterances")
        .delete()
        .in("transcript_id", staleIds);
      if (uError) fail("createTranscript (delete utterances)", uError);
      const { error: tError } = await this.client
        .from("transcripts")
        .delete()
        .in("id", staleIds);
      if (tError) fail("createTranscript (delete transcripts)", tError);
    }

    const { data, error } = await this.client
      .from("transcripts")
      .insert({
        meeting_id: input.meeting_id,
        raw_json: input.raw_json,
        language: input.language,
        diarized: input.diarized ?? true,
      })
      .select()
      .single();
    if (error) fail("createTranscript", error);
    return mapTranscript(data as TranscriptRow);
  }

  async getTranscriptByMeeting(meetingId: string): Promise<Transcript | null> {
    const { data, error } = await this.client
      .from("transcripts")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("getTranscriptByMeeting", error);
    return data ? mapTranscript(data as TranscriptRow) : null;
  }

  async createUtterances(
    transcriptId: string,
    utterances: NewUtterance[]
  ): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < utterances.length; i += CHUNK) {
      const chunk = utterances.slice(i, i + CHUNK).map((u) => ({
        transcript_id: transcriptId,
        speaker_label: u.speaker_label,
        start_ms: u.start_ms,
        end_ms: u.end_ms,
        text: u.text,
      }));
      const { error } = await this.client.from("utterances").insert(chunk);
      if (error) fail("createUtterances", error);
    }
  }

  async listUtterances(transcriptId: string): Promise<Utterance[]> {
    // Page past PostgREST's default 1000-row cap: long meetings easily exceed it.
    const PAGE = 1000;
    const all: Utterance[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await this.client
        .from("utterances")
        .select("id, transcript_id, speaker_label, speaker_name, start_ms, end_ms, text")
        .eq("transcript_id", transcriptId)
        .order("start_ms", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) fail("listUtterances", error);
      const rows = (data ?? []) as UtteranceRow[];
      all.push(...rows.map(mapUtterance));
      if (rows.length < PAGE) break;
    }
    return all;
  }

  async updateUtteranceSpeakerName(
    utteranceId: string,
    speakerName: string
  ): Promise<Utterance> {
    const { data, error } = await this.client
      .from("utterances")
      .update({ speaker_name: speakerName })
      .eq("id", utteranceId)
      .select("id, transcript_id, speaker_label, speaker_name, start_ms, end_ms, text")
      .single();
    if (error) fail("updateUtteranceSpeakerName", error);
    return mapUtterance(data as UtteranceRow);
  }

  async applySpeakerNameToLabel(
    transcriptId: string,
    speakerLabel: string,
    speakerName: string
  ): Promise<number> {
    const { data, error } = await this.client
      .from("utterances")
      .update({ speaker_name: speakerName })
      .eq("transcript_id", transcriptId)
      .eq("speaker_label", speakerLabel)
      .select("id");
    if (error) fail("applySpeakerNameToLabel", error);
    return ((data ?? []) as Array<{ id: string }>).length;
  }

  // -- summaries --------------------------------------------------------------

  async createSummary(
    meetingId: string,
    content: MeetingSummaryContent
  ): Promise<Summary> {
    const { data, error } = await this.client
      .from("summaries")
      .insert({
        meeting_id: meetingId,
        overview: content.overview,
        key_decisions: content.key_decisions,
        action_items: content.action_items,
        topics: content.topics,
        full_markdown: content.full_markdown,
      })
      .select()
      .single();
    if (error) fail("createSummary", error);
    return mapSummary(data as SummaryRow);
  }

  async getSummaryByMeeting(meetingId: string): Promise<Summary | null> {
    const { data, error } = await this.client
      .from("summaries")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("getSummaryByMeeting", error);
    return data ? mapSummary(data as SummaryRow) : null;
  }

  // -- speaker aliases ---------------------------------------------------------

  async upsertSpeakerAlias(input: {
    body_name: string;
    speaker_label_pattern: string;
    display_name: string;
  }): Promise<SpeakerAlias> {
    const { data, error } = await this.client
      .from("speaker_aliases")
      .upsert(
        {
          body_name: input.body_name,
          speaker_label_pattern: input.speaker_label_pattern,
          display_name: input.display_name,
        },
        { onConflict: "body_name,speaker_label_pattern" }
      )
      .select()
      .single();
    if (error) fail("upsertSpeakerAlias", error);
    return mapAlias(data as SpeakerAliasRow);
  }

  async listSpeakerAliases(bodyName?: string): Promise<SpeakerAlias[]> {
    let builder = this.client.from("speaker_aliases").select("*");
    if (bodyName !== undefined) builder = builder.eq("body_name", bodyName);
    const { data, error } = await builder.order("created_at", {
      ascending: true,
    });
    if (error) fail("listSpeakerAliases", error);
    return ((data ?? []) as SpeakerAliasRow[]).map(mapAlias);
  }

  // -- jobs ---------------------------------------------------------------------

  async enqueueJob(
    meetingId: string,
    type: JobType,
    payload?: Record<string, unknown>
  ): Promise<Job> {
    const { data, error } = await this.client
      .from("jobs")
      .insert({ meeting_id: meetingId, type, payload: payload ?? {} })
      .select()
      .single();
    if (error) fail("enqueueJob", error);
    return mapJob(data as JobRow);
  }

  async claimNextJob(): Promise<Job | null> {
    const { data, error } = await this.client.rpc("claim_next_job");
    if (error) fail("claimNextJob", error);
    // claim_next_job() returns SETOF jobs: an array with zero or one row.
    const rows: JobRow[] = Array.isArray(data)
      ? (data as JobRow[])
      : data
        ? [data as JobRow]
        : [];
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async completeJob(jobId: string): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({ status: "complete", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) fail("completeJob", error);
  }

  async failJob(jobId: string, error: string): Promise<Job> {
    // Read-then-update; the single worker claiming model (claim_next_job locks
    // the row into "running") means no one else races on this job's attempts.
    const { data: current, error: readError } = await this.client
      .from("jobs")
      .select("attempts")
      .eq("id", jobId)
      .single();
    if (readError) fail("failJob (read)", readError);

    const attempts = (current as { attempts: number }).attempts + 1;
    const status: JobStatus =
      attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";

    const { data, error: updateError } = await this.client
      .from("jobs")
      .update({
        attempts,
        status,
        last_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select()
      .single();
    if (updateError) fail("failJob (update)", updateError);
    return mapJob(data as JobRow);
  }

  async updateJobPayload(
    jobId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({ payload, updated_at: new Date().toISOString() }) // full replace
      .eq("id", jobId);
    if (error) fail("updateJobPayload", error);
  }

  async requeueJob(jobId: string): Promise<void> {
    // Not a failure: attempts and last_error stay untouched.
    const { error } = await this.client
      .from("jobs")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) fail("requeueJob", error);
  }

  async reapStaleJobs(olderThanMs: number): Promise<Job[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data, error } = await this.client
      .from("jobs")
      .select("*")
      .eq("status", "running")
      .lt("updated_at", cutoff);
    if (error) fail("reapStaleJobs (read)", error);

    // Read-then-update per row is fine here: lease-expired running jobs are
    // rare, and the only other writer racing us would be a concurrent reaper
    // performing the exact same recovery.
    const reaped: Job[] = [];
    for (const row of (data ?? []) as JobRow[]) {
      const attempts = row.attempts + 1;
      const status: JobStatus =
        attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";
      const { data: updated, error: updateError } = await this.client
        .from("jobs")
        .update({
          attempts,
          status,
          last_error: "worker lease expired (process died mid-job?)",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select()
        .single();
      if (updateError) fail("reapStaleJobs (update)", updateError);
      reaped.push(mapJob(updated as JobRow));
    }
    return reaped;
  }

  async getJobsByMeeting(meetingId: string): Promise<Job[]> {
    const { data, error } = await this.client
      .from("jobs")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });
    if (error) fail("getJobsByMeeting", error);
    return ((data ?? []) as JobRow[]).map(mapJob);
  }

  // -- search ---------------------------------------------------------------------

  async searchUtterances(
    query: string,
    opts?: { meetingId?: string; limit?: number; publishedOnly?: boolean }
  ): Promise<UtteranceSearchResult[]> {
    const q = query.trim();
    if (q === "") return [];
    const limit = opts?.limit ?? 100;

    // Delegate to the search_utterances() RPC (migration 0004), which joins
    // utterances -> transcripts -> meetings and orders by meetings.created_at
    // DESC before applying LIMIT, so the fetched window and the final order
    // agree and the newest meetings' hits are never truncated out. We re-apply
    // orderSearchResults() defensively so the result is byte-for-byte the same
    // ordering MemoryStore produces.
    const { data, error } = await this.client.rpc("search_utterances", {
      p_query: q,
      p_limit: limit,
      p_meeting_id: opts?.meetingId ?? null,
    });
    if (error) fail("searchUtterances", error);

    let rows = (data ?? []) as SearchUtteranceRow[];

    // Published boundary: the RPC does not filter on publish state, so when
    // publishedOnly is set we drop hits whose meeting is not published. This
    // keeps parity with MemoryStore (which filters inline) without altering the
    // RPC. The candidate set is small (one search window), so a single id->
    // published lookup is cheap.
    if (opts?.publishedOnly) {
      const meetingIds = [...new Set(rows.map((r) => r.meeting_id))];
      if (meetingIds.length === 0) return [];
      const { data: pub, error: pubError } = await this.client
        .from("meetings")
        .select("id")
        .eq("published", true)
        .in("id", meetingIds);
      if (pubError) fail("searchUtterances (published filter)", pubError);
      const publishedIds = new Set(
        ((pub ?? []) as Array<{ id: string }>).map((m) => m.id)
      );
      rows = rows.filter((r) => publishedIds.has(r.meeting_id));
    }

    const results: UtteranceSearchResult[] = rows.map((row) => ({
      utterance: {
        id: row.id,
        transcript_id: row.transcript_id,
        speaker_label: row.speaker_label,
        speaker_name: row.speaker_name,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        text: row.text,
      },
      meeting: {
        id: row.meeting_id,
        title: row.meeting_title,
        body_name: row.meeting_body_name,
        created_at: row.meeting_created_at,
      },
    }));

    return orderSearchResults(results).slice(0, limit);
  }

  // -- schedules --------------------------------------------------------------

  async createSchedule(input: NewSchedule): Promise<Schedule> {
    const { data, error } = await this.client
      .from("schedules")
      .insert({
        title: input.title,
        body_name: input.body_name,
        kind: input.kind ?? "civic",
        source_type: input.source_type,
        source_spec: input.source_spec,
        recurrence: input.recurrence,
        enabled: input.enabled ?? true,
        next_fire_at: input.next_fire_at,
      })
      .select()
      .single();
    if (error) fail("createSchedule", error);
    return mapSchedule(data as ScheduleRow);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    const { data, error } = await this.client
      .from("schedules")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("getSchedule", error);
    return data ? mapSchedule(data as ScheduleRow) : null;
  }

  async listSchedules(): Promise<Schedule[]> {
    const { data, error } = await this.client
      .from("schedules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) fail("listSchedules", error);
    return ((data ?? []) as ScheduleRow[]).map(mapSchedule);
  }

  async updateSchedule(id: string, patch: ScheduleUpdate): Promise<Schedule> {
    const { data, error } = await this.client
      .from("schedules")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) fail("updateSchedule", error);
    return mapSchedule(data as ScheduleRow);
  }

  async deleteSchedule(id: string): Promise<void> {
    const { error } = await this.client.from("schedules").delete().eq("id", id);
    if (error) fail("deleteSchedule", error);
  }

  async listDueSchedules(now: Date): Promise<Schedule[]> {
    const { data, error } = await this.client
      .from("schedules")
      .select("*")
      .eq("enabled", true)
      .lte("next_fire_at", now.toISOString())
      .order("next_fire_at", { ascending: true });
    if (error) fail("listDueSchedules", error);
    return ((data ?? []) as ScheduleRow[]).map(mapSchedule);
  }
}

/** One row returned by the search_utterances() RPC (migration 0004). */
interface SearchUtteranceRow {
  id: string;
  transcript_id: string;
  speaker_label: string;
  speaker_name: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  meeting_id: string;
  meeting_title: string;
  meeting_body_name: string;
  meeting_created_at: string;
}

// ---------------------------------------------------------------------------
// SupabaseFileStorage

const AUDIO_BUCKET = "meeting-audio";

export class SupabaseFileStorage implements FileStorage {
  private readonly client: SupabaseClient;

  constructor(config: AppConfig) {
    this.client = makeClient(config, "SupabaseFileStorage");
  }

  async put(storagePath: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(AUDIO_BUCKET)
      .upload(normalizeKey(storagePath), data, { contentType, upsert: true });
    if (error) fail("storage upload", error);
  }

  async get(
    storagePath: string
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const { data, error } = await this.client.storage
      .from(AUDIO_BUCKET)
      .download(normalizeKey(storagePath));
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    const contentType =
      data.type && data.type !== "" ? data.type : "application/octet-stream";
    return { data: bytes, contentType };
  }

  async stat(
    storagePath: string
  ): Promise<{ size: number; contentType: string } | null> {
    const url = await this.signedUrl(storagePath);
    if (!url) return null;
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") ?? "");
    if (!Number.isFinite(size)) return null;
    return {
      size,
      contentType:
        res.headers.get("content-type") || "application/octet-stream",
    };
  }

  async getRange(
    storagePath: string,
    range?: { start: number; end: number }
  ): Promise<ReadableStream<Uint8Array> | null> {
    const url = await this.signedUrl(storagePath);
    if (!url) return null;
    const headers: Record<string, string> = {};
    if (range) headers.Range = `bytes=${range.start}-${range.end}`;
    // Stream directly from Supabase Storage (which supports Range) instead of
    // download()-ing the whole object into a Buffer.
    const res = await fetch(url, { headers });
    if (!(res.ok || res.status === 206) || !res.body) return null;
    return res.body as ReadableStream<Uint8Array>;
  }

  /** Short-lived signed URL for direct, ranged reads from Supabase Storage. */
  private async signedUrl(storagePath: string): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(normalizeKey(storagePath), 3600);
    if (error || !data) return null;
    return data.signedUrl;
  }

  async delete(storagePath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(AUDIO_BUCKET)
      .remove([normalizeKey(storagePath)]);
    if (error) fail("storage delete", error);
  }

  publicUrl(storagePath: string): string {
    return "/api/audio/" + normalizeKey(storagePath);
  }
}
