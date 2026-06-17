// Capture stage. Gets meeting audio into file storage by source_type:
//  - upload: the file was placed in storage at creation time — pass-through.
//  - zoom/teams/meet: create a Recall.ai bot ONCE (the bot id is persisted in the job
//            payload so retries reuse it instead of sending duplicate bots
//            into the meeting), then check its status once per tick. While
//            the bot is still recording the stage throws JobNotReadyError so
//            the runner requeues the job — no in-process poll loop. The mock
//            capture provider returns "done" immediately, so mock-mode ticks
//            still complete the whole stage in a single pass.
//  - stream: run the stream ingest provider (yt-dlp) and store the audio.
// On success the meeting moves to "transcribing"; the runner enqueues the
// transcribe job.

import type { Job, Meeting } from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";
import { JobNotReadyError } from "@/lib/jobs/errors";
import { persistTranscription } from "@/lib/jobs/persist-transcript";

/** Give up on a meeting bot whose recording never becomes ready. */
const BOT_CAPTURE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function extensionForContentType(contentType: string): string {
  const base = (contentType.split(";")[0] ?? contentType).trim().toLowerCase();
  return EXT_BY_CONTENT_TYPE[base] ?? "wav";
}

function audioPathFor(meetingId: string, contentType: string): string {
  return `meetings/${meetingId}/audio.${extensionForContentType(contentType)}`;
}

export async function handleCapture(
  job: Job,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  const meeting = await store.getMeeting(job.meeting_id);
  if (!meeting) {
    throw new Error(`Meeting ${job.meeting_id} not found`);
  }

  switch (meeting.source_type) {
    case "upload": {
      // Audio was uploaded to storage when the meeting was created.
      if (!meeting.audio_storage_path) {
        throw new Error(
          `Upload meeting ${meeting.id} has no audio_storage_path: the file was never uploaded`
        );
      }
      break;
    }
    case "zoom":
    case "teams":
    case "meet": {
      await captureBot(job, meeting, store, files, providers);
      break;
    }
    case "stream": {
      await captureStream(meeting, store, files, providers);
      break;
    }
    default: {
      const unknownSource: never = meeting.source_type;
      throw new Error(`Unknown source_type: ${String(unknownSource)}`);
    }
  }

  // Capture done — advance the visible status; the runner enqueues transcribe.
  await store.setMeetingStatus(meeting.id, "transcribing");
}

async function captureBot(
  job: Job,
  meeting: Meeting,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  if (!meeting.source_url) {
    throw new Error(`Meeting ${meeting.id} has no source_url`);
  }

  // Reuse the bot recorded in the job payload; create one only on the first
  // pass. Persisting {botId, botCreatedAt} IMMEDIATELY after creation means a
  // crash or retry can never send a second bot into the same meeting.
  let botId =
    typeof job.payload.botId === "string" ? job.payload.botId : null;
  let botCreatedAt =
    typeof job.payload.botCreatedAt === "string"
      ? job.payload.botCreatedAt
      : null;
  if (!botId) {
    const created = await providers.capture.createBot(
      meeting.source_url,
      meeting.id,
      { liveTranscription: meeting.live_enabled === true }
    );
    botId = created.botId;
    botCreatedAt = new Date().toISOString();
    await store.updateJobPayload(job.id, {
      ...job.payload,
      botId,
      botCreatedAt,
    });
  }

  // Single status check per tick — no in-process sleep/poll loop. If the bot
  // isn't done yet, JobNotReadyError requeues the job and a later tick checks
  // again. (The mock provider reports "done" immediately.)
  const bot = await providers.capture.getBotStatus(botId);

  if (bot.status === "failed") {
    throw new Error(
      `Recall bot ${botId} failed: ${bot.error ?? "unknown error"}`
    );
  }

  if (bot.status !== "done") {
    // Normal-Error timeout so standard retry/failure semantics apply once a
    // bot has been out for 6 hours without producing a recording.
    const createdAtMs = botCreatedAt ? Date.parse(botCreatedAt) : NaN;
    if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs > BOT_CAPTURE_TIMEOUT_MS) {
      throw new Error("meeting capture timed out after 6h");
    }
    await store.setMeetingStatus(meeting.id, "capturing");
    throw new JobNotReadyError("bot still recording");
  }

  if (!bot.audioUrl) {
    throw new Error(
      `Recall bot ${botId} reported done but returned no audio URL`
    );
  }

  // Live captions end when the bot finishes: mark the live window closed so the
  // public live page can show "ended". (live_started_at is set by the webhook on
  // the first utterance.) Only meaningful when live was enabled.
  if (meeting.live_enabled && meeting.live_ended_at == null) {
    await store.updateMeeting(meeting.id, {
      live_ended_at: new Date().toISOString(),
    });
  }

  const { data, contentType } = await providers.capture.downloadAudio(
    bot.audioUrl
  );
  const path = audioPathFor(meeting.id, contentType);
  await files.put(path, data, contentType);
  await store.updateMeeting(meeting.id, { audio_storage_path: path });
}

async function captureStream(
  meeting: Meeting,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  if (!meeting.source_url) {
    throw new Error(`Stream meeting ${meeting.id} has no source_url`);
  }

  await store.setMeetingStatus(meeting.id, "capturing");

  // Fast lane: if the source has an existing caption track, build the
  // transcript from it and skip both the audio download and AssemblyAI.
  // fetchCaptions never throws for the "no captions" case — a null result
  // (no track / fast lane disabled / fetch failed) falls through to audio.
  const captions = await providers.streamIngest.fetchCaptions(
    meeting.source_url
  );
  // Only take the fast lane when the caption track actually carries utterances.
  // An empty track (0 cues) must NOT short-circuit to an empty transcript: fall
  // through to audio extraction + AssemblyAI, which is the real content.
  if (captions && captions.utterances.length > 0) {
    await persistTranscription(store, meeting, captions, { diarized: false });
    return; // no audio stored; the transcribe stage will no-op
  }

  const { data, contentType, durationSeconds } =
    await providers.streamIngest.extractAudio(meeting.source_url);

  const path = audioPathFor(meeting.id, contentType);
  await files.put(path, data, contentType);
  await store.updateMeeting(meeting.id, {
    audio_storage_path: path,
    ...(durationSeconds != null
      ? { duration_seconds: Math.round(durationSeconds) }
      : {}),
  });
}
