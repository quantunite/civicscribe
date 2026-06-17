// Transcribe stage. Reads the captured audio from file storage, runs the
// transcription provider (AssemblyAI or mock — transcription + diarization in
// one call), and persists the transcript + utterances (+ speaker aliases) via
// the shared persistTranscription helper.
//
// Caption fast lane: when the capture stage already produced a transcript from
// an existing caption track, the meeting has no audio to transcribe — this
// stage detects that and no-ops, leaving the runner to enqueue summarize.

import type { Job } from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";
import { persistTranscription } from "@/lib/jobs/persist-transcript";

export async function handleTranscribe(
  job: Job,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  const meeting = await store.getMeeting(job.meeting_id);
  if (!meeting) {
    throw new Error(`Meeting ${job.meeting_id} not found`);
  }

  await store.setMeetingStatus(meeting.id, "transcribing");

  // Caption fast lane already produced the transcript in the capture stage and
  // left no audio behind. Nothing to do — the runner enqueues summarize.
  if (!meeting.audio_storage_path) {
    const existing = await store.getTranscriptByMeeting(meeting.id);
    if (existing) return;
    throw new Error(
      `Meeting ${meeting.id} has no audio_storage_path: capture must run first`
    );
  }

  const audio = await files.get(meeting.audio_storage_path);
  if (!audio) {
    throw new Error(
      `Audio file missing from storage: ${meeting.audio_storage_path}`
    );
  }

  const result = await providers.transcription.transcribe({
    kind: "bytes",
    data: audio.data,
    contentType: audio.contentType,
  });

  // A transcript with zero utterances is not a success: the source had no
  // audible speech (a silent/empty recording, or a capture of a meeting that
  // never actually happened at the scheduled time). Fail with a clear reason
  // instead of letting the pipeline mark the meeting "complete" with an empty
  // transcript the user can't tell apart from a bug.
  if (result.utterances.length === 0) {
    throw new Error(
      "transcription produced no speech — the recording had no audible content " +
        "(the source may have been silent, empty, or not actually live at the capture time)"
    );
  }

  await persistTranscription(store, meeting, result, { diarized: true });
}
