// MemoryStore.deleteMeeting cascade + LocalFileStorage.delete.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage, MemoryStore } from "@/lib/store/memory";
import type { MeetingSummaryContent } from "@/lib/types";
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

const SUMMARY: MeetingSummaryContent = {
  overview: "o",
  key_decisions: ["d"],
  action_items: ["a"],
  topics: ["t"],
  full_markdown: "# m",
};

async function seedMeeting(title: string) {
  const meeting = await store.createMeeting({
    title,
    body_name: "City Council",
    source_type: "stream",
    source_url: "https://x/v",
  });
  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: {},
    language: "en",
  });
  await store.createUtterances(transcript.id, [
    { speaker_label: "A", start_ms: 0, end_ms: 1000, text: "hi" },
  ]);
  await store.createSummary(meeting.id, SUMMARY);
  await store.enqueueJob(meeting.id, "notify");
  return { meeting, transcript };
}

describe("MemoryStore.deleteMeeting", () => {
  it("removes the meeting and all dependent rows, leaving others intact", async () => {
    const a = await seedMeeting("A");
    const b = await seedMeeting("B");
    await store.upsertSpeakerAlias({
      body_name: "City Council",
      speaker_label_pattern: "A",
      display_name: "Mayor",
    });

    await store.deleteMeeting(a.meeting.id);

    // A is fully gone.
    expect(await store.getMeeting(a.meeting.id)).toBeNull();
    expect(await store.getTranscriptByMeeting(a.meeting.id)).toBeNull();
    expect(await store.listUtterances(a.transcript.id)).toEqual([]);
    expect(await store.getSummaryByMeeting(a.meeting.id)).toBeNull();
    expect(await store.getJobsByMeeting(a.meeting.id)).toEqual([]);

    // B is untouched.
    expect(await store.getMeeting(b.meeting.id)).not.toBeNull();
    expect(await store.getTranscriptByMeeting(b.meeting.id)).not.toBeNull();
    expect(await store.listUtterances(b.transcript.id)).toHaveLength(1);
    expect(await store.getSummaryByMeeting(b.meeting.id)).not.toBeNull();
    expect(await store.getJobsByMeeting(b.meeting.id)).toHaveLength(1);

    // Per-body speaker aliases survive (not meeting-scoped).
    expect(await store.listSpeakerAliases("City Council")).toHaveLength(1);
  });

  it("is a no-op for an unknown meeting id", async () => {
    await seedMeeting("A");
    await expect(store.deleteMeeting("does-not-exist")).resolves.toBeUndefined();
    expect(await store.listMeetings()).toHaveLength(1);
  });
});

describe("LocalFileStorage.delete", () => {
  it("removes the blob and its sidecar", async () => {
    const files = new LocalFileStorage(dataDir);
    await files.put("meetings/m/audio.wav", Buffer.from("x"), "audio/wav");
    expect(await files.get("meetings/m/audio.wav")).not.toBeNull();

    await files.delete("meetings/m/audio.wav");
    expect(await files.get("meetings/m/audio.wav")).toBeNull();
  });

  it("does not throw when the file is already gone", async () => {
    const files = new LocalFileStorage(dataDir);
    await expect(files.delete("meetings/none/audio.wav")).resolves.toBeUndefined();
  });
});
