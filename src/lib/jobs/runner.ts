// Job runner. One invocation claims at most one pending job, dispatches it to
// the matching pipeline stage, and on success enqueues the next stage in the
// chain: capture -> transcribe -> summarize -> notify (terminal).
//
// Failure handling: store.failJob() increments attempts and either requeues
// the job or, after MAX_JOB_ATTEMPTS, marks it failed. Only then is the
// meeting itself flipped to "failed" with the error surfaced for the UI.
//
// processOneJob never throws — the tick route and the Recall webhook both
// call it fire-and-forget.

import { getConfig } from "@/lib/config";
import { getProviders } from "@/lib/providers";
import { getFileStorage, getStore } from "@/lib/store";
import type { JobType } from "@/lib/types";
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

export interface ProcessOneJobResult {
  processed: boolean;
  job?: { id: string; type: string; meeting_id: string; status: string };
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function processOneJob(): Promise<ProcessOneJobResult> {
  try {
    const store = getStore();
    const job = await store.claimNextJob();
    if (!job) {
      return { processed: false };
    }

    const files = getFileStorage();
    const providers = getProviders();
    const config = getConfig();

    try {
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

      await store.completeJob(job.id);

      const next = NEXT_STAGE[job.type];
      if (next) {
        await store.enqueueJob(job.meeting_id, next);
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
      const message = errorMessage(err);
      const failed = await store.failJob(job.id, message);
      if (failed.status === "failed") {
        // Out of attempts: surface the error on the meeting itself.
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
  } catch (err) {
    // Claiming / bookkeeping itself blew up — report, never throw.
    return { processed: false, error: errorMessage(err) };
  }
}
