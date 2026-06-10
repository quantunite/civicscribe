// Transcribe stage. Reads the captured audio from file storage, runs the
// transcription provider (AssemblyAI or mock — transcription + diarization in
// one call), persists the transcript + utterances, and applies any stored
// speaker aliases for this meeting's body so recurring speakers get their
// real names automatically.

import type { Job } from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";

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

  if (!meeting.audio_storage_path) {
    throw new Error(
      `Meeting ${meeting.id} has no audio_storage_path — capture must run first`
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

  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: result.rawJson,
    language: result.language,
  });

  await store.createUtterances(
    transcript.id,
    result.utterances.map((u) => ({
      speaker_label: u.speaker_label,
      start_ms: u.start_ms,
      end_ms: u.end_ms,
      text: u.text,
    }))
  );

  // Apply stored speaker aliases for this body: an alias applies when its
  // speaker_label_pattern exactly matches an utterance speaker_label.
  const aliases = await store.listSpeakerAliases(meeting.body_name);
  if (aliases.length > 0) {
    const labels = new Set(result.utterances.map((u) => u.speaker_label));
    for (const alias of aliases) {
      if (labels.has(alias.speaker_label_pattern)) {
        await store.applySpeakerNameToLabel(
          transcript.id,
          alias.speaker_label_pattern,
          alias.display_name
        );
      }
    }
  }

  if (result.durationSeconds != null && meeting.duration_seconds == null) {
    await store.updateMeeting(meeting.id, {
      duration_seconds: Math.round(result.durationSeconds),
    });
  }
}
