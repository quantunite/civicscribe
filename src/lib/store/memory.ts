// MOCK_MODE persistence layer.
//
// MemoryStore is a file-backed JSON DataStore: all state lives in memory and
// is written through to {dataDir}/db.json after every mutation, so the app
// (and the seed script / worker, when they share a process with the Next
// server) survives restarts without any external services. All operations are
// serialized through a simple promise-chain mutex so concurrent route
// invocations cannot double-claim jobs or interleave read-modify-write cycles.
//
// LocalFileStorage stores blobs under {dataDir}/storage/<path> with a
// "<path>.meta.json" sidecar holding the content type. publicUrl always
// returns "/api/audio/<path>" so the browser-facing URL shape is identical to
// the Supabase-backed implementation.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_JOB_ATTEMPTS,
  type Job,
  type JobType,
  type Meeting,
  type MeetingKind,
  type MeetingStatus,
  type MeetingSummaryContent,
  type NewMeeting,
  type NewUtterance,
  type SpeakerAlias,
  type Summary,
  type Transcript,
  type Utterance,
  type UtteranceSearchResult,
} from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// helpers

interface DbShape {
  meetings: Meeting[];
  transcripts: Transcript[];
  utterances: Utterance[];
  summaries: Summary[];
  speaker_aliases: SpeakerAlias[];
  jobs: Job[];
}

function emptyDb(): DbShape {
  return {
    meetings: [],
    transcripts: [],
    utterances: [],
    summaries: [],
    speaker_aliases: [],
    jobs: [],
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function now(): string {
  return new Date().toISOString();
}

/** Deep-copy values crossing the store boundary so callers can't mutate state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// MemoryStore

export class MemoryStore implements DataStore {
  private readonly dbPath: string;
  private db: DbShape | null = null;
  /** mtime of db.json when we last read or wrote it — see load(). */
  private dbMtimeMs: number | null = null;
  /** Promise-chain mutex: every operation runs strictly after the previous one. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.dbPath = path.resolve(dataDir, "db.json");
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    // Run after the previous operation regardless of whether it succeeded,
    // and never let a rejection poison the chain for the next caller.
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async fileMtimeMs(): Promise<number | null> {
    try {
      return (await stat(this.dbPath)).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Lazy-load db.json; tolerate missing/corrupt files. Reloads whenever
   *  another process rewrote the file since we last read or wrote it (e.g.
   *  `npm run seed` while the dev server is up) — without the mtime check a
   *  stale cached snapshot would clobber the other process's writes on our
   *  next persist(). Multi-process WRITE races remain last-write-wins; the
   *  multi-process backend is Supabase. */
  private async load(): Promise<DbShape> {
    const mtime = await this.fileMtimeMs();
    if (this.db && mtime === this.dbMtimeMs) return this.db;
    try {
      const raw = await readFile(this.dbPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const rec = (
        parsed && typeof parsed === "object" ? parsed : {}
      ) as Record<string, unknown>;
      this.db = {
        // Coerce legacy rows written before the kind column existed.
        meetings: asArray<Meeting>(rec.meetings).map((m) => ({
          ...m,
          kind: m.kind ?? "civic",
        })),
        transcripts: asArray<Transcript>(rec.transcripts),
        utterances: asArray<Utterance>(rec.utterances),
        summaries: asArray<Summary>(rec.summaries),
        speaker_aliases: asArray<SpeakerAlias>(rec.speaker_aliases),
        jobs: asArray<Job>(rec.jobs),
      };
    } catch {
      // Missing or corrupt file: start empty.
      this.db = emptyDb();
    }
    this.dbMtimeMs = mtime;
    return this.db;
  }

  /** Write-through after every mutation (atomic-ish: temp file + rename). */
  private async persist(): Promise<void> {
    if (!this.db) return;
    await mkdir(path.dirname(this.dbPath), { recursive: true });
    const tmp = `${this.dbPath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2), "utf8");
    await rename(tmp, this.dbPath);
    this.dbMtimeMs = await this.fileMtimeMs();
  }

  // -- meetings -------------------------------------------------------------

  createMeeting(input: NewMeeting): Promise<Meeting> {
    return this.withLock(async () => {
      const db = await this.load();
      const meeting: Meeting = {
        id: randomUUID(),
        title: input.title,
        body_name: input.body_name,
        source_type: input.source_type,
        kind: input.kind ?? "civic",
        source_url: input.source_url ?? null,
        status: "pending",
        error_message: null,
        scheduled_at: input.scheduled_at ?? null,
        audio_storage_path: input.audio_storage_path ?? null,
        duration_seconds: null,
        created_at: now(),
      };
      db.meetings.push(meeting);
      await this.persist();
      return clone(meeting);
    });
  }

  getMeeting(id: string): Promise<Meeting | null> {
    return this.withLock(async () => {
      const db = await this.load();
      const meeting = db.meetings.find((m) => m.id === id);
      return meeting ? clone(meeting) : null;
    });
  }

  listMeetings(kind?: MeetingKind): Promise<Meeting[]> {
    return this.withLock(async () => {
      const db = await this.load();
      const all = kind
        ? db.meetings.filter((m) => m.kind === kind)
        : db.meetings;
      // Newest first; insertion order breaks created_at ties deterministically.
      const indexOf = new Map(all.map((m, i) => [m.id, i]));
      return [...all]
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            (indexOf.get(b.id) ?? 0) - (indexOf.get(a.id) ?? 0)
        )
        .map(clone);
    });
  }

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
  ): Promise<Meeting> {
    return this.withLock(async () => {
      const db = await this.load();
      const meeting = db.meetings.find((m) => m.id === id);
      if (!meeting) throw new Error(`Meeting not found: ${id}`);
      if (patch.status !== undefined) meeting.status = patch.status;
      if (patch.error_message !== undefined)
        meeting.error_message = patch.error_message;
      if (patch.audio_storage_path !== undefined)
        meeting.audio_storage_path = patch.audio_storage_path;
      if (patch.duration_seconds !== undefined)
        meeting.duration_seconds = patch.duration_seconds;
      if (patch.title !== undefined) meeting.title = patch.title;
      await this.persist();
      return clone(meeting);
    });
  }

  setMeetingStatus(
    id: string,
    status: MeetingStatus,
    errorMessage?: string | null
  ): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const meeting = db.meetings.find((m) => m.id === id);
      if (!meeting) throw new Error(`Meeting not found: ${id}`);
      meeting.status = status;
      meeting.error_message = errorMessage ?? null;
      await this.persist();
    });
  }

  deleteMeeting(id: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const before = db.meetings.length;
      db.meetings = db.meetings.filter((m) => m.id !== id);
      if (db.meetings.length === before) return; // nothing to delete

      // Cascade: drop the meeting's transcript(s), their utterances, its
      // summary, and its jobs. Speaker aliases are per-body, not per-meeting,
      // so they are intentionally left alone.
      const transcriptIds = new Set(
        db.transcripts.filter((t) => t.meeting_id === id).map((t) => t.id)
      );
      db.transcripts = db.transcripts.filter((t) => t.meeting_id !== id);
      db.utterances = db.utterances.filter(
        (u) => !transcriptIds.has(u.transcript_id)
      );
      db.summaries = db.summaries.filter((s) => s.meeting_id !== id);
      db.jobs = db.jobs.filter((j) => j.meeting_id !== id);
      await this.persist();
    });
  }

  // -- transcripts & utterances ----------------------------------------------

  createTranscript(input: {
    meeting_id: string;
    raw_json: unknown;
    language: string;
    diarized?: boolean;
  }): Promise<Transcript> {
    return this.withLock(async () => {
      const db = await this.load();
      // Replace semantics: drop any existing transcript (and its utterances)
      // for this meeting so a retried transcribe stage is idempotent and
      // never leaves duplicates or orphans behind.
      const staleIds = new Set(
        db.transcripts
          .filter((t) => t.meeting_id === input.meeting_id)
          .map((t) => t.id)
      );
      if (staleIds.size > 0) {
        db.transcripts = db.transcripts.filter((t) => !staleIds.has(t.id));
        db.utterances = db.utterances.filter(
          (u) => !staleIds.has(u.transcript_id)
        );
      }
      const transcript: Transcript = {
        id: randomUUID(),
        meeting_id: input.meeting_id,
        raw_json: input.raw_json,
        language: input.language,
        diarized: input.diarized ?? true,
        created_at: now(),
      };
      db.transcripts.push(transcript);
      await this.persist();
      return clone(transcript);
    });
  }

  getTranscriptByMeeting(meetingId: string): Promise<Transcript | null> {
    return this.withLock(async () => {
      const db = await this.load();
      const matches = db.transcripts
        .filter((t) => t.meeting_id === meetingId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      // Coerce legacy rows written before the diarized column existed.
      return matches[0]
        ? clone({ ...matches[0], diarized: matches[0].diarized ?? true })
        : null;
    });
  }

  createUtterances(
    transcriptId: string,
    utterances: NewUtterance[]
  ): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const rows = utterances.map<Utterance>((u) => ({
        id: randomUUID(),
        transcript_id: transcriptId,
        speaker_label: u.speaker_label,
        speaker_name: null,
        start_ms: u.start_ms,
        end_ms: u.end_ms,
        text: u.text,
      }));
      db.utterances.push(...rows);
      await this.persist();
    });
  }

  listUtterances(transcriptId: string): Promise<Utterance[]> {
    return this.withLock(async () => {
      const db = await this.load();
      return db.utterances
        .filter((u) => u.transcript_id === transcriptId)
        .sort((a, b) => a.start_ms - b.start_ms)
        .map(clone);
    });
  }

  updateUtteranceSpeakerName(
    utteranceId: string,
    speakerName: string
  ): Promise<Utterance> {
    return this.withLock(async () => {
      const db = await this.load();
      const utterance = db.utterances.find((u) => u.id === utteranceId);
      if (!utterance) throw new Error(`Utterance not found: ${utteranceId}`);
      utterance.speaker_name = speakerName;
      await this.persist();
      return clone(utterance);
    });
  }

  applySpeakerNameToLabel(
    transcriptId: string,
    speakerLabel: string,
    speakerName: string
  ): Promise<number> {
    return this.withLock(async () => {
      const db = await this.load();
      let count = 0;
      for (const u of db.utterances) {
        if (u.transcript_id === transcriptId && u.speaker_label === speakerLabel) {
          u.speaker_name = speakerName;
          count += 1;
        }
      }
      if (count > 0) await this.persist();
      return count;
    });
  }

  // -- summaries --------------------------------------------------------------

  createSummary(
    meetingId: string,
    content: MeetingSummaryContent
  ): Promise<Summary> {
    return this.withLock(async () => {
      const db = await this.load();
      // Replace any existing summary so re-running the summarize stage (or the
      // seed script) never leaves stale duplicates behind.
      db.summaries = db.summaries.filter((s) => s.meeting_id !== meetingId);
      const summary: Summary = {
        id: randomUUID(),
        meeting_id: meetingId,
        overview: content.overview,
        key_decisions: [...content.key_decisions],
        action_items: [...content.action_items],
        topics: [...content.topics],
        full_markdown: content.full_markdown,
      };
      db.summaries.push(summary);
      await this.persist();
      return clone(summary);
    });
  }

  getSummaryByMeeting(meetingId: string): Promise<Summary | null> {
    return this.withLock(async () => {
      const db = await this.load();
      const summary = db.summaries.find((s) => s.meeting_id === meetingId);
      return summary ? clone(summary) : null;
    });
  }

  // -- speaker aliases ---------------------------------------------------------

  upsertSpeakerAlias(input: {
    body_name: string;
    speaker_label_pattern: string;
    display_name: string;
  }): Promise<SpeakerAlias> {
    return this.withLock(async () => {
      const db = await this.load();
      const existing = db.speaker_aliases.find(
        (a) =>
          a.body_name === input.body_name &&
          a.speaker_label_pattern === input.speaker_label_pattern
      );
      if (existing) {
        existing.display_name = input.display_name;
        await this.persist();
        return clone(existing);
      }
      const alias: SpeakerAlias = {
        id: randomUUID(),
        body_name: input.body_name,
        speaker_label_pattern: input.speaker_label_pattern,
        display_name: input.display_name,
      };
      db.speaker_aliases.push(alias);
      await this.persist();
      return clone(alias);
    });
  }

  listSpeakerAliases(bodyName?: string): Promise<SpeakerAlias[]> {
    return this.withLock(async () => {
      const db = await this.load();
      return db.speaker_aliases
        .filter((a) => bodyName === undefined || a.body_name === bodyName)
        .map(clone);
    });
  }

  // -- jobs ---------------------------------------------------------------------

  enqueueJob(
    meetingId: string,
    type: JobType,
    payload?: Record<string, unknown>
  ): Promise<Job> {
    return this.withLock(async () => {
      const db = await this.load();
      const job: Job = {
        id: randomUUID(),
        meeting_id: meetingId,
        type,
        status: "pending",
        attempts: 0,
        last_error: null,
        payload: payload ? clone(payload) : {},
        created_at: now(),
        updated_at: now(),
      };
      db.jobs.push(job);
      await this.persist();
      return clone(job);
    });
  }

  claimNextJob(): Promise<Job | null> {
    // The promise-chain mutex makes claim atomic: two concurrent invocations
    // run one after the other, so the second sees the first claim's "running".
    return this.withLock(async () => {
      const db = await this.load();
      let next: Job | null = null;
      for (const job of db.jobs) {
        // Strict "<" keeps insertion order as the tiebreak for equal timestamps,
        // so the oldest pending job always wins.
        if (job.status === "pending" && (!next || job.created_at < next.created_at)) {
          next = job;
        }
      }
      if (!next) return null;
      next.status = "running";
      next.updated_at = now();
      await this.persist();
      return clone(next);
    });
  }

  completeJob(jobId: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      job.status = "complete";
      job.updated_at = now();
      await this.persist();
    });
  }

  failJob(jobId: string, error: string): Promise<Job> {
    return this.withLock(async () => {
      const db = await this.load();
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      job.attempts += 1;
      job.last_error = error;
      job.status = job.attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";
      job.updated_at = now();
      await this.persist();
      return clone(job);
    });
  }

  updateJobPayload(
    jobId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      job.payload = clone(payload); // full replace, not a merge
      job.updated_at = now();
      await this.persist();
    });
  }

  requeueJob(jobId: string): Promise<void> {
    return this.withLock(async () => {
      const db = await this.load();
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      // Not a failure: attempts and last_error stay untouched.
      job.status = "pending";
      job.updated_at = now();
      await this.persist();
    });
  }

  reapStaleJobs(olderThanMs: number): Promise<Job[]> {
    return this.withLock(async () => {
      const db = await this.load();
      const cutoff = Date.now() - olderThanMs;
      const reaped: Job[] = [];
      for (const job of db.jobs) {
        if (job.status !== "running") continue;
        const updatedAt = Date.parse(job.updated_at);
        if (Number.isNaN(updatedAt) || updatedAt >= cutoff) continue;
        job.attempts += 1;
        job.last_error = "worker lease expired (process died mid-job?)";
        job.status = job.attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending";
        job.updated_at = now();
        reaped.push(clone(job));
      }
      if (reaped.length > 0) await this.persist();
      return reaped;
    });
  }

  getJobsByMeeting(meetingId: string): Promise<Job[]> {
    return this.withLock(async () => {
      const db = await this.load();
      return db.jobs
        .filter((j) => j.meeting_id === meetingId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(clone);
    });
  }

  // -- search ---------------------------------------------------------------------

  searchUtterances(
    query: string,
    opts?: { meetingId?: string; limit?: number }
  ): Promise<UtteranceSearchResult[]> {
    return this.withLock(async () => {
      const db = await this.load();
      const tokens = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      if (tokens.length === 0) return [];
      const limit = opts?.limit ?? 100;

      const meetingsById = new Map(db.meetings.map((m) => [m.id, m]));
      const transcriptToMeeting = new Map<string, Meeting>();
      for (const t of db.transcripts) {
        const meeting = meetingsById.get(t.meeting_id);
        if (meeting) transcriptToMeeting.set(t.id, meeting);
      }

      const results: UtteranceSearchResult[] = [];
      for (const u of db.utterances) {
        const meeting = transcriptToMeeting.get(u.transcript_id);
        if (!meeting) continue;
        if (opts?.meetingId && meeting.id !== opts.meetingId) continue;
        const haystack = u.text.toLowerCase();
        if (!tokens.every((tok) => haystack.includes(tok))) continue;
        results.push({
          utterance: clone(u),
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
    });
  }
}

// ---------------------------------------------------------------------------
// LocalFileStorage

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, "storage");
  }

  /** Map a storage key like "meetings/<id>/audio.wav" to a path under root,
   *  rejecting anything that would escape it. */
  private resolvePath(storagePath: string): string {
    const rel = storagePath.replace(/^[/\\]+/, "");
    const full = path.resolve(this.root, rel);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (!full.startsWith(rootWithSep)) {
      throw new Error(`Invalid storage path: ${storagePath}`);
    }
    return full;
  }

  async put(storagePath: string, data: Buffer, contentType: string): Promise<void> {
    const full = this.resolvePath(storagePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    await writeFile(
      `${full}.meta.json`,
      JSON.stringify({ contentType }, null, 2),
      "utf8"
    );
  }

  async get(
    storagePath: string
  ): Promise<{ data: Buffer; contentType: string } | null> {
    const full = this.resolvePath(storagePath);
    let data: Buffer;
    try {
      data = await readFile(full);
    } catch {
      return null;
    }
    let contentType = "application/octet-stream";
    try {
      const meta: unknown = JSON.parse(await readFile(`${full}.meta.json`, "utf8"));
      if (
        meta &&
        typeof meta === "object" &&
        typeof (meta as { contentType?: unknown }).contentType === "string"
      ) {
        contentType = (meta as { contentType: string }).contentType;
      }
    } catch {
      // Missing/corrupt sidecar: fall back to the generic content type.
    }
    return { data, contentType };
  }

  async delete(storagePath: string): Promise<void> {
    const full = this.resolvePath(storagePath);
    // Best-effort: a missing file (or sidecar) must never fail a delete.
    await rm(full, { force: true }).catch(() => {});
    await rm(`${full}.meta.json`, { force: true }).catch(() => {});
  }

  publicUrl(storagePath: string): string {
    return "/api/audio/" + storagePath.replace(/^[/\\]+/, "");
  }
}
