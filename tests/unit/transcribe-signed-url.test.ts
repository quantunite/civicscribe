// Transcribe stage memory posture: when the storage backend can mint a signed
// URL, the stage MUST hand it straight to the transcription provider and never
// buffer the (potentially hundreds-of-MB) recording into this process. That
// buffering was the dominant OOM risk on Railway, where one container runs the
// web server and the job loop in a single Node heap. When no signed URL is
// available (local-disk dev), it falls back to reading the bytes via get().

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
import { handleTranscribe } from "@/lib/jobs/stages/transcribe";
import type { FileStorage } from "@/lib/store/types";
import type {
  AudioSource,
  Providers,
  TranscriptionResult,
} from "@/lib/providers/types";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

const RESULT: TranscriptionResult = {
  rawJson: { ok: true },
  language: "en",
  durationSeconds: 12,
  utterances: [{ speaker_label: "A", start_ms: 0, end_ms: 1000, text: "Hi." }],
};

/** A FileStorage whose signedReadUrl returns `url`; get() throws so the test
 *  proves the bytes path is never taken when a URL is available. */
function filesWithSignedUrl(url: string | null): FileStorage {
  return {
    async put() {},
    async get() {
      throw new Error("get() must not be called when a signed URL is available");
    },
    async stat() {
      return null;
    },
    async getRange() {
      return null;
    },
    async delete() {},
    publicUrl: (p: string) => `/api/audio/${p}`,
    async signedReadUrl() {
      return url;
    },
  };
}

/** Records the AudioSource the transcription provider was handed. */
function recordingProviders(sink: { audio?: AudioSource }): Providers {
  const unused = () => {
    throw new Error("provider not expected in this test");
  };
  return {
    capture: {
      createBot: unused,
      getBotStatus: unused,
      downloadAudio: unused,
    },
    streamIngest: { fetchCaptions: unused, extractAudio: unused },
    transcription: {
      async transcribe(audio: AudioSource) {
        sink.audio = audio;
        return RESULT;
      },
    },
    summary: {
      summarize: unused,
      synthesizeTopic: unused,
      catchUp: unused,
    },
    email: { sendCompletionEmail: unused },
  } as unknown as Providers;
}

describe("handleTranscribe signed-URL posture", () => {
  it("hands the provider a signed URL and never buffers the audio bytes", async () => {
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "upload",
      audio_storage_path: "meetings/m/audio.wav",
    });
    const job = await store.enqueueJob(meeting.id, "transcribe");
    const sink: { audio?: AudioSource } = {};

    await handleTranscribe(
      job,
      store,
      filesWithSignedUrl("https://signed.example/audio?token=abc"),
      recordingProviders(sink)
    );

    expect(sink.audio).toEqual({
      kind: "url",
      url: "https://signed.example/audio?token=abc",
    });
    // The transcript persisted, so the stage ran end-to-end on the URL path.
    expect(await store.getTranscriptByMeeting(meeting.id)).not.toBeNull();
  });

  it("falls back to reading the bytes when no signed URL is available", async () => {
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "upload",
      audio_storage_path: "meetings/m/audio.wav",
    });
    const job = await store.enqueueJob(meeting.id, "transcribe");
    const sink: { audio?: AudioSource } = {};

    // signedReadUrl returns null, and get() returns bytes for the fallback.
    const files: FileStorage = {
      ...filesWithSignedUrl(null),
      async get() {
        return { data: Buffer.from("fake audio"), contentType: "audio/wav" };
      },
    };

    await handleTranscribe(job, store, files, recordingProviders(sink));

    expect(sink.audio?.kind).toBe("bytes");
    expect(await store.getTranscriptByMeeting(meeting.id)).not.toBeNull();
  });
});
