// Notify stage (terminal). Sends the completion email when NOTIFY_EMAIL is
// configured. The meeting is already "complete" before this stage runs, so
// notify is strictly best-effort: missing config is a silent no-op and a
// failed send is logged but never thrown — a broken email must not flip a
// finished meeting back to "failed".

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

  try {
    const meeting = await store.getMeeting(job.meeting_id);
    if (!meeting) {
      console.warn(
        `[notify] meeting ${job.meeting_id} not found — skipping completion email`
      );
      return;
    }

    const summary = await store.getSummaryByMeeting(meeting.id);
    await providers.email.sendCompletionEmail(
      config.notifyEmail,
      meeting,
      summary
    );
  } catch (err) {
    console.error(
      `[notify] failed to send completion email for meeting ${job.meeting_id}:`,
      err
    );
  }
}
