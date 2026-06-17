// Capture stage stream branch: fetch captions first, persist a non-diarized
// transcript and skip audio on a hit; fall back to extractAudio on a miss.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileStorage, MemoryStore } from "@/lib/store/memory";
import { handleCapture } from "@/lib/jobs/stages/capture";
import type { Providers } from "@/lib/providers/types";
import { buildFixtureCaptionResult } from "@/lib/fixtures/captions";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;
let files: LocalFileStorage;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
  files = new LocalFileStorage(dataDir);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

function streamProviders(over: {
  fetchCaptions: ReturnType<typeof vi.fn>;
  extractAudio: ReturnType<typeof vi.fn>;
}): Providers {
  return { streamIngest: over } as unknown as Providers;
}

async function streamMeeting() {
  return store.createMeeting({
    title: "T",
    body_name: "City Council",
    source_type: "stream",
    source_url: "https://x/v",
  });
}

describe("captureStream caption fast lane", () => {
  it("persists a caption transcript and skips audio when captions exist", async () => {
    const meeting = await streamMeeting();
    const extractAudio = vi.fn();
    const providers = streamProviders({
      fetchCaptions: vi.fn().mockResolvedValue(buildFixtureCaptionResult()),
      extractAudio,
    });
    const job = await store.enqueueJob(meeting.id, "capture");

    await handleCapture(job, store, files, providers);

    expect(extractAudio).not.toHaveBeenCalled();
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(false);
    const after = await store.getMeeting(meeting.id);
    expect(after?.audio_storage_path).toBeNull();
  });

  it("falls back to extractAudio when the caption track is empty (0 cues)", async () => {
    const meeting = await streamMeeting();
    const extractAudio = vi.fn().mockResolvedValue({
      data: Buffer.from("x"),
      contentType: "audio/wav",
      durationSeconds: 120,
    });
    // A caption track that exists but carries no utterances must NOT short-circuit
    // to an empty transcript — it should fall through to real audio capture.
    const providers = streamProviders({
      fetchCaptions: vi.fn().mockResolvedValue({
        rawJson: {},
        language: "en",
        durationSeconds: null,
        utterances: [],
      }),
      extractAudio,
    });
    const job = await store.enqueueJob(meeting.id, "capture");

    await handleCapture(job, store, files, providers);

    expect(extractAudio).toHaveBeenCalledTimes(1);
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t).toBeNull();
    const after = await store.getMeeting(meeting.id);
    expect(after?.audio_storage_path).toBeTruthy();
  });

  it("falls back to extractAudio when there are no captions", async () => {
    const meeting = await streamMeeting();
    const extractAudio = vi.fn().mockResolvedValue({
      data: Buffer.from("x"),
      contentType: "audio/wav",
      durationSeconds: 120,
    });
    const providers = streamProviders({
      fetchCaptions: vi.fn().mockResolvedValue(null),
      extractAudio,
    });
    const job = await store.enqueueJob(meeting.id, "capture");

    await handleCapture(job, store, files, providers);

    expect(extractAudio).toHaveBeenCalledTimes(1);
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t).toBeNull();
    const after = await store.getMeeting(meeting.id);
    expect(after?.audio_storage_path).toBeTruthy();
  });
});
