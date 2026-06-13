// transcripts.diarized: defaults to true, persists false for caption transcripts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
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

async function streamMeeting() {
  return store.createMeeting({
    title: "T",
    body_name: "City Council",
    source_type: "stream",
    source_url: "https://example.com/v",
  });
}

describe("transcripts.diarized", () => {
  it("defaults to true when not specified", async () => {
    const meeting = await streamMeeting();
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
    });
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(true);
  });

  it("persists diarized=false for caption transcripts", async () => {
    const meeting = await streamMeeting();
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
      diarized: false,
    });
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(false);
  });
});
