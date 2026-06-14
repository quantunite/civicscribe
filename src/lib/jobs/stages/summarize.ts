// Summarize stage. Sends the diarized transcript to the summary provider
// (Anthropic or mock), persists the structured summary, and marks the meeting
// complete. The runner then enqueues the terminal notify job.

import type { Job } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";

export async function handleSummarize(
  job: Job,
  store: DataStore,
  providers: Providers
): Promise<void> {
  const meeting = await store.getMeeting(job.meeting_id);
  if (!meeting) {
    throw new Error(`Meeting ${job.meeting_id} not found`);
  }

  await store.setMeetingStatus(meeting.id, "summarizing");

  const transcript = await store.getTranscriptByMeeting(meeting.id);
  if (!transcript) {
    throw new Error(
      `Meeting ${meeting.id} has no transcript: transcribe must run first`
    );
  }

  const utterances = await store.listUtterances(transcript.id);

  const content = await providers.summary.summarize({
    meetingTitle: meeting.title,
    bodyName: meeting.body_name,
    kind: meeting.kind,
    diarized: transcript.diarized,
    utterances: utterances.map((u) => ({
      speaker: u.speaker_name ?? `Speaker ${u.speaker_label}`,
      text: u.text,
    })),
  });

  await store.createSummary(meeting.id, content);
  await store.setMeetingStatus(meeting.id, "complete");
}
