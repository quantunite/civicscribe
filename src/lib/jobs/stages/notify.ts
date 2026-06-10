// Notify stage (terminal). Sends the completion email when NOTIFY_EMAIL is
// configured. Missing config stays a silent no-op, but a REAL send error
// throws so the runner retries the job (up to MAX_JOB_ATTEMPTS) — transient
// email-provider hiccups get another chance instead of being swallowed.
// The meeting is already "complete" before this stage runs; the runner never
// changes a meeting's status for notify jobs, so even a terminally failed
// notify can't flip a finished meeting back to "failed".

import type { Job } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";
import type { AppConfig } from "@/lib/config";

export async function handleNotify(
  job: Job,
  store: DataStore,
  providers: Providers,
  config: AppConfig
): Promise<void> {
  if (!config.notifyEmail) {
    return; // notifications not configured — nothing to do
  }

  const meeting = await store.getMeeting(job.meeting_id);
  if (!meeting) {
    console.warn(
      `[notify] meeting ${job.meeting_id} not found — skipping completion email`
    );
    return;
  }

  const summary = await store.getSummaryByMeeting(meeting.id);
  // Throws on failure so the runner's retry semantics apply.
  await providers.email.sendCompletionEmail(
    config.notifyEmail,
    meeting,
    summary
  );
}
