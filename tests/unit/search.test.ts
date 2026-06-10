// MemoryStore.searchUtterances: case-insensitive AND-of-tokens matching,
// meeting scoping, limit, and within-meeting start_ms ordering.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;
let meeting1Id: string;
let meeting2Id: string;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);

  const m1 = await store.createMeeting({
    title: "Council Regular Session",
    body_name: "Lawrence City Council",
    source_type: "upload",
  });
  meeting1Id = m1.id;
  const t1 = await store.createTranscript({
    meeting_id: m1.id,
    raw_json: {},
    language: "en",
  });
  await store.createUtterances(t1.id, [
    { speaker_label: "A", start_ms: 0, end_ms: 900, text: "The drainage plan needs a real review." },
    { speaker_label: "B", start_ms: 1000, end_ms: 1900, text: "Drainage is my main concern tonight." },
    { speaker_label: "C", start_ms: 2000, end_ms: 2900, text: "The plan was distributed in the packet." },
    { speaker_label: "D", start_ms: 3000, end_ms: 3900, text: "PLEASE MAKE THE DRAINAGE PLAN REAL." },
  ]);

  const m2 = await store.createMeeting({
    title: "Planning Commission Hearing",
    body_name: "Planning Commission",
    source_type: "upload",
  });
  meeting2Id = m2.id;
  const t2 = await store.createTranscript({
    meeting_id: m2.id,
    raw_json: {},
    language: "en",
  });
  await store.createUtterances(t2.id, [
    { speaker_label: "A", start_ms: 500, end_ms: 1400, text: "We also debated a drainage plan here." },
    { speaker_label: "B", start_ms: 1500, end_ms: 2400, text: "Sidewalk repairs were approved." },
  ]);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

describe("MemoryStore.searchUtterances", () => {
  it("requires every token to appear (AND semantics)", async () => {
    const results = await store.searchUtterances("drainage plan", {
      meetingId: meeting1Id,
    });

    const texts = results.map((r) => r.utterance.text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain("The drainage plan needs a real review.");
    expect(texts).toContain("PLEASE MAKE THE DRAINAGE PLAN REAL.");
    // Single-token-only matches are excluded.
    expect(texts).not.toContain("Drainage is my main concern tonight.");
    expect(texts).not.toContain("The plan was distributed in the packet.");
  });

  it("matches case-insensitively in both directions", async () => {
    const upperQuery = await store.searchUtterances("DRAINAGE", {
      meetingId: meeting1Id,
    });
    expect(upperQuery).toHaveLength(3);

    const lowerAgainstUpperText = await store.searchUtterances("please make", {
      meetingId: meeting1Id,
    });
    expect(lowerAgainstUpperText).toHaveLength(1);
    expect(lowerAgainstUpperText[0].utterance.speaker_label).toBe("D");
  });

  it("returns [] for empty or whitespace-only queries", async () => {
    expect(await store.searchUtterances("")).toEqual([]);
    expect(await store.searchUtterances("   \t  ")).toEqual([]);
  });

  it("returns [] when nothing matches", async () => {
    expect(await store.searchUtterances("zamboni")).toEqual([]);
  });

  it("scopes to a meeting when meetingId is given", async () => {
    const all = await store.searchUtterances("drainage");
    expect(all).toHaveLength(4);

    const onlyM2 = await store.searchUtterances("drainage", {
      meetingId: meeting2Id,
    });
    expect(onlyM2).toHaveLength(1);
    expect(onlyM2[0].meeting.id).toBe(meeting2Id);
    expect(onlyM2[0].meeting.title).toBe("Planning Commission Hearing");
  });

  it("orders within a meeting by start_ms and respects limit", async () => {
    const results = await store.searchUtterances("drainage", {
      meetingId: meeting1Id,
    });
    const starts = results.map((r) => r.utterance.start_ms);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    const limited = await store.searchUtterances("drainage", {
      meetingId: meeting1Id,
      limit: 1,
    });
    expect(limited).toHaveLength(1);
    expect(limited[0].utterance.start_ms).toBe(0);
  });

  it("includes the meeting summary fields on each hit", async () => {
    const [hit] = await store.searchUtterances("sidewalk");
    expect(hit.meeting).toEqual({
      id: meeting2Id,
      title: "Planning Commission Hearing",
      body_name: "Planning Commission",
      created_at: expect.any(String),
    });
  });
});
