// Persist a TranscriptionResult (transcript row + utterances + speaker-alias
// application + duration backfill). Shared by the audio path (transcribe stage)
// and the caption fast lane (capture stage) so both persist identically.

import type { Meeting } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import type { TranscriptionResult } from "@/lib/providers/types";

export async function persistTranscription(
  store: DataStore,
  meeting: Meeting,
  result: TranscriptionResult,
  opts: { diarized: boolean }
): Promise<void> {
  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: result.rawJson,
    language: result.language,
    diarized: opts.diarized,
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

  // Apply stored speaker aliases for this body. No-op for caption transcripts,
  // whose single "CAPTION" label never matches a real alias pattern.
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
