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
  type NewUtterance,
  type SourceType,
  type MeetingKind,
  type SpeakerAlias,
  type Summary,
  type Transcript,
  type Utterance,
  type UtteranceSearchResult,
} from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";

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
      })
      .select()
      .single();
    if (error) fail("createMeeting", error);
    return mapMeeting(data as MeetingRow);
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
    opts?: { meetingId?: string; limit?: number }
  ): Promise<UtteranceSearchResult[]> {
    const q = query.trim();
    if (q === "") return [];
    const limit = opts?.limit ?? 100;

    // Order on the DB query so the fetched window is deterministic across
    // runs. Fetch-window limitation: when more than `limit` rows match, the
    // DB returns the first `limit` in (start_ms, id) order — NOT necessarily
    // the rows the newest-meeting-first sort below would prefer. Acceptable
    // for single-user v1; fixing it properly needs a joined query.
    let builder = this.client
      .from("utterances")
      .select("id, transcript_id, speaker_label, speaker_name, start_ms, end_ms, text")
      .textSearch("text_search", q, { type: "websearch" })
      .order("start_ms", { ascending: true })
      .order("id", { ascending: true });

    if (opts?.meetingId) {
      const { data: tData, error: tError } = await this.client
        .from("transcripts")
        .select("id")
        .eq("meeting_id", opts.meetingId);
      if (tError) fail("searchUtterances (transcripts)", tError);
      const transcriptIds = ((tData ?? []) as Array<{ id: string }>).map(
        (t) => t.id
      );
      if (transcriptIds.length === 0) return [];
      builder = builder.in("transcript_id", transcriptIds);
    }

    const { data, error } = await builder.limit(limit);
    if (error) fail("searchUtterances", error);
    const utterances = ((data ?? []) as UtteranceRow[]).map(mapUtterance);
    if (utterances.length === 0) return [];

    // Enrich with meeting info: transcript_id -> meeting_id -> meeting.
    const transcriptIds = [...new Set(utterances.map((u) => u.transcript_id))];
    const { data: trData, error: trError } = await this.client
      .from("transcripts")
      .select("id, meeting_id")
      .in("id", transcriptIds);
    if (trError) fail("searchUtterances (join transcripts)", trError);
    const transcriptToMeetingId = new Map(
      ((trData ?? []) as Array<{ id: string; meeting_id: string }>).map((t) => [
        t.id,
        t.meeting_id,
      ])
    );

    const meetingIds = [...new Set([...transcriptToMeetingId.values()])];
    if (meetingIds.length === 0) return [];
    const { data: mData, error: mError } = await this.client
      .from("meetings")
      .select("id, title, body_name, created_at")
      .in("id", meetingIds);
    if (mError) fail("searchUtterances (join meetings)", mError);
    const meetingsById = new Map(
      (
        (mData ?? []) as Array<
          Pick<Meeting, "id" | "title" | "body_name" | "created_at">
        >
      ).map((m) => [m.id, m])
    );

    const results: UtteranceSearchResult[] = [];
    for (const utterance of utterances) {
      const meetingId = transcriptToMeetingId.get(utterance.transcript_id);
      const meeting = meetingId ? meetingsById.get(meetingId) : undefined;
      if (!meeting) continue;
      results.push({
        utterance,
        meeting: {
          id: meeting.id,
          title: meeting.title,
          body_name: meeting.body_name,
          created_at: meeting.created_at,
        },
      });
    }

    results.sort(
      (a, b) =>
        b.meeting.created_at.localeCompare(a.meeting.created_at) ||
        a.meeting.id.localeCompare(b.meeting.id) ||
        a.utterance.start_ms - b.utterance.start_ms
    );

    return results.slice(0, limit);
  }
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
