// Job runner. One invocation claims at most one pending job, dispatches it to
// the matching pipeline stage, and on success enqueues the next stage in the
// chain: capture -> transcribe -> summarize -> notify (terminal).
//
// Failure handling: store.failJob() increments attempts and either requeues
// the job or, after MAX_JOB_ATTEMPTS, marks it failed. Only then is the
// meeting itself flipped to "failed" with the error surfaced for the UI —
// except for notify jobs, which run after the meeting is already "complete"
// and must never flip it back.
//
// Not-ready handling: a stage throws JobNotReadyError when its external work
// (e.g. a Zoom bot still recording) isn't finished. The job is requeued
// without counting an attempt or touching the meeting's error state.
//
// Crash recovery: every invocation first reaps jobs stuck in "running" past
// the worker lease, then runs a cheap reconcile pass that fails meetings
// stranded in a processing status with no live job to advance them.
//
// processOneJob never throws — the tick route and the Recall webhook both
// call it fire-and-forget.

import { getConfig } from "@/lib/config";
import { getProviders } from "@/lib/providers";
import { getFileStorage, getStore } from "@/lib/store";
import { log } from "@/lib/logger";
import { MAX_JOB_ATTEMPTS, type JobType, type MeetingStatus } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import { JobNotReadyError } from "@/lib/jobs/errors";
import { handleCapture } from "@/lib/jobs/stages/capture";
import { handleTranscribe } from "@/lib/jobs/stages/transcribe";
import { handleSummarize } from "@/lib/jobs/stages/summarize";
import { handleNotify } from "@/lib/jobs/stages/notify";

const NEXT_STAGE: Partial<Record<JobType, JobType>> = {
  capture: "transcribe",
  transcribe: "summarize",
  summarize: "notify",
  // notify is terminal
};

// Worker lease. A "running" job older than this is presumed orphaned (the
// process died mid-job) and is reaped. MUST exceed the longest legitimate
// in-tick work: the AssemblyAI transcribe stage can poll in-process for up to
// 30 minutes, so the lease is 45.
const LEASE_MS = 45 * 60 * 1000;

/** Meeting statuses that imply a job should be pending/running for it. */
const PROCESSING_STATUSES: ReadonlySet<MeetingStatus> = new Set([
  "pending",
  "capturing",
  "transcribing",
  "summarizing",
]);

/** Grace period before a processing meeting with zero jobs is declared dead. */
const ORPHAN_MEETING_GRACE_MS = 10 * 60 * 1000;

export interface ProcessOneJobResult {
  processed: boolean;
  job?: { id: string; type: string; meeting_id: string; status: string };
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reap lease-expired running jobs; surface terminal failures on meetings. */
async function reapStaleJobs(store: DataStore): Promise<void> {
  const reaped = await store.reapStaleJobs(LEASE_MS);
  for (const job of reaped) {
    // A reaped notify job must never flip an already-complete meeting.
    if (job.status === "failed" && job.type !== "notify") {
      await store.setMeetingStatus(
        job.meeting_id,
        "failed",
        job.last_error ?? "worker lease expired (process died mid-job?)"
      );
    }
  }
}

/** Cheap reconcile pass: fail meetings stuck in a processing status with no
 *  live job left to advance them (terminally failed job, or no job at all). */
async function reconcileMeetings(store: DataStore): Promise<void> {
  const meetings = await store.listMeetings();
  const nowMs = Date.now();
  for (const meeting of meetings) {
    if (!PROCESSING_STATUSES.has(meeting.status)) continue;
    const jobs = await store.getJobsByMeeting(meeting.id);
    const hasLiveJob = jobs.some(
      (j) => j.status === "pending" || j.status === "running"
    );
    if (hasLiveJob) continue;
    // Exclude notify failures from the trigger: a dead notify email must not
    // fail a meeting (and a complete meeting isn't in the processing set
    // anyway — this guards the stranded-mid-pipeline edge case).
    const exhausted = jobs.find(
      (j) =>
        j.status === "failed" &&
        j.type !== "notify" &&
        j.attempts >= MAX_JOB_ATTEMPTS
    );
    const createdAtMs = Date.parse(meeting.created_at);
    const orphaned =
      jobs.length === 0 &&
      !Number.isNaN(createdAtMs) &&
      nowMs - createdAtMs > ORPHAN_MEETING_GRACE_MS;
    if (exhausted) {
      await store.setMeetingStatus(
        meeting.id,
        "failed",
        exhausted.last_error ?? "job failed"
      );
    } else if (orphaned) {
      await store.setMeetingStatus(meeting.id, "failed", "no job enqueued");
    }
  }
}

export async function processOneJob(): Promise<ProcessOneJobResult> {
  try {
    const store = getStore();

    // Crash recovery first, but never let it block job processing.
    try {
      await reapStaleJobs(store);
      await reconcileMeetings(store);
    } catch (err) {
      log.error("runner: crash-recovery pass failed", {
        error: errorMessage(err),
      });
    }

    const job = await store.claimNextJob();
    if (!job) {
      return { processed: false };
    }

    try {
      // Resolve storage/providers/config INSIDE the try, after claiming: a
      // constructor throw (e.g. missing env) then goes through the normal
      // failJob path instead of leaking a permanently "running" job.
      const files = getFileStorage();
      const providers = getProviders();
      const config = getConfig();

      switch (job.type) {
        case "capture":
          await handleCapture(job, store, files, providers);
          break;
        case "transcribe":
          await handleTranscribe(job, store, files, providers);
          break;
        case "summarize":
          await handleSummarize(job, store, providers);
          break;
        case "notify":
          await handleNotify(job, store, providers, config);
          break;
        default: {
          const unknownType: never = job.type;
          throw new Error(`Unknown job type: ${String(unknownType)}`);
        }
      }
    } catch (err) {
      if (err instanceof JobNotReadyError) {
        // External work still in progress (e.g. Zoom bot recording): requeue
        // without counting an attempt or touching the meeting's error state.
        await store.requeueJob(job.id);
        return {
          processed: true,
          job: {
            id: job.id,
            type: job.type,
            meeting_id: job.meeting_id,
            status: "pending",
          },
        };
      }

      const message = errorMessage(err);
      const failed = await store.failJob(job.id, message);
      // Out of attempts: surface the error on the meeting itself — unless
      // this is a notify job, whose meeting is already "complete" and must
      // not be flipped back by a broken email.
      if (failed.status === "failed" && job.type !== "notify") {
        await store.setMeetingStatus(job.meeting_id, "failed", message);
      }
      return {
        processed: true,
        job: {
          id: job.id,
          type: job.type,
          meeting_id: job.meeting_id,
          status: failed.status,
        },
        error: message,
      };
    }

    // The stage itself succeeded — bookkeeping only beyond this point. If
    // completeJob/enqueueJob throws, do NOT mark the meeting failed: the work
    // is done, the job merely stays "running" until the lease reaper requeues
    // it (the idempotent stages make the re-run safe).
    try {
      await store.completeJob(job.id);
      const next = NEXT_STAGE[job.type];
      if (next) {
        await store.enqueueJob(job.meeting_id, next);
      }
    } catch (err) {
      const message = errorMessage(err);
      log.error(
        "runner: post-stage bookkeeping failed; leaving job running for the lease reaper",
        { jobId: job.id, type: job.type, error: message }
      );
      return {
        processed: true,
        job: {
          id: job.id,
          type: job.type,
          meeting_id: job.meeting_id,
          status: "running",
        },
        error: message,
      };
    }

    return {
      processed: true,
      job: {
        id: job.id,
        type: job.type,
        meeting_id: job.meeting_id,
        status: "complete",
      },
    };
  } catch (err) {
    // Claiming / bookkeeping itself blew up — report, never throw.
    return { processed: false, error: errorMessage(err) };
  }
}
