// Transcribe stage short-circuit: when the caption fast lane already produced a
// transcript (and there is no audio), the transcription provider is never called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileStorage, MemoryStore } from "@/lib/store/memory";
import { handleTranscribe } from "@/lib/jobs/stages/transcribe";
import type { Providers } from "@/lib/providers/types";
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

describe("handleTranscribe short-circuit", () => {
  it("no-ops when captions already produced a transcript (no audio)", async () => {
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://x/v",
    });
    // Caption fast lane already persisted a transcript; no audio_storage_path.
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
      diarized: false,
    });

    const transcribe = vi.fn();
    const providers = { transcription: { transcribe } } as unknown as Providers;
    const job = await store.enqueueJob(meeting.id, "transcribe");

    await handleTranscribe(job, store, files, providers);

    expect(transcribe).not.toHaveBeenCalled();
  });

  it("throws when there is neither audio nor a transcript", async () => {
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://x/v",
    });
    const transcribe = vi.fn();
    const providers = { transcription: { transcribe } } as unknown as Providers;
    const job = await store.enqueueJob(meeting.id, "transcribe");

    await expect(
      handleTranscribe(job, store, files, providers)
    ).rejects.toThrow(/no audio_storage_path/);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("fails (does not persist) when transcription returns zero utterances", async () => {
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://x/v",
    });
    // Give it audio so the transcribe path actually runs the provider.
    await files.put("meetings/x/audio.wav", Buffer.from("x"), "audio/wav");
    await store.updateMeeting(meeting.id, {
      audio_storage_path: "meetings/x/audio.wav",
    });

    const transcribe = vi.fn().mockResolvedValue({
      rawJson: {},
      language: "en",
      durationSeconds: 60,
      utterances: [],
    });
    const providers = { transcription: { transcribe } } as unknown as Providers;
    const job = await store.enqueueJob(meeting.id, "transcribe");

    await expect(
      handleTranscribe(job, store, files, providers)
    ).rejects.toThrow(/no speech/i);
    // No empty transcript row left behind for the summarize stage to choke on.
    expect(await store.getTranscriptByMeeting(meeting.id)).toBeNull();
  });
});
