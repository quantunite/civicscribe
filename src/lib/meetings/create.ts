// Shared "create a meeting + enqueue its capture job" path. Used by both
// POST /api/meetings (on-demand) and the scheduler sweep (recurring), so the
// two stay in lockstep — including the guarantee that a failed enqueue never
// strands a zombie "pending" meeting no job will ever advance.

import type { DataStore } from "@/lib/store/types";
import type { Meeting, NewMeeting } from "@/lib/types";

export async function createAndEnqueueCapture(
  store: DataStore,
  input: NewMeeting
): Promise<Meeting> {
  const meeting = await store.createMeeting(input);
  try {
    await store.enqueueJob(meeting.id, "capture");
  } catch (err) {
    await store
      .setMeetingStatus(
        meeting.id,
        "failed",
        "failed to enqueue processing job"
      )
      .catch(() => {});
    throw err;
  }
  return meeting;
}
