// Capture stage. Gets meeting audio into file storage by source_type:
//  - upload: the file was placed in storage at creation time — pass-through.
//  - zoom:   create a Recall.ai bot, poll until the recording is ready
//            (mock returns "done" immediately; real bots can take a while,
//            so we poll every 10s for up to 20 minutes inside one tick),
//            then download the audio into storage.
//  - stream: run the stream ingest provider (yt-dlp) and store the audio.
// On success the meeting moves to "transcribing"; the runner enqueues the
// transcribe job.

import type { Job, Meeting } from "@/lib/types";
import type { DataStore, FileStorage } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 20 * 60 * 1000; // 20 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
          `Upload meeting ${meeting.id} has no audio_storage_path — the file was never uploaded`
        );
      }
      break;
    }
    case "zoom": {
      await captureZoom(meeting, store, files, providers);
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

async function captureZoom(
  meeting: Meeting,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  if (!meeting.source_url) {
    throw new Error(`Zoom meeting ${meeting.id} has no source_url`);
  }

  await store.setMeetingStatus(meeting.id, "capturing");

  const { botId } = await providers.capture.createBot(
    meeting.source_url,
    meeting.id
  );

  // Poll until the recording is ready. Status is checked before the first
  // sleep so the mock provider ("done" immediately) keeps ticks fast.
  const deadline = Date.now() + MAX_POLL_MS;
  let audioUrl: string | undefined;
  for (;;) {
    const bot = await providers.capture.getBotStatus(botId);
    if (bot.status === "done") {
      audioUrl = bot.audioUrl;
      break;
    }
    if (bot.status === "failed") {
      throw new Error(
        `Recall bot ${botId} failed: ${bot.error ?? "unknown error"}`
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${MAX_POLL_MS / 60_000} minutes waiting for Recall bot ${botId} recording`
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (!audioUrl) {
    throw new Error(`Recall bot ${botId} reported done but returned no audio URL`);
  }

  const { data, contentType } = await providers.capture.downloadAudio(audioUrl);
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
