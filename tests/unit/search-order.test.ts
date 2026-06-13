// orderSearchResults: the shared recency ordering used by both stores. Bug 2
// was that SupabaseStore applied its DB LIMIT to a start_ms-ordered fetch
// BEFORE this recency sort, so newest meetings could be dropped. Extracting and
// testing the ordering pins the contract both stores must satisfy.

import { describe, expect, it } from "vitest";

import { orderSearchResults } from "@/lib/store/search-order";
import type { UtteranceSearchResult } from "@/lib/types";

function result(
  meetingId: string,
  createdAt: string,
  startMs: number,
  text = "x"
): UtteranceSearchResult {
  return {
    utterance: {
      id: `${meetingId}-${startMs}`,
      transcript_id: `${meetingId}-t`,
      speaker_label: "A",
      speaker_name: null,
      start_ms: startMs,
      end_ms: startMs + 100,
      text,
    },
    meeting: {
      id: meetingId,
      title: meetingId,
      body_name: "b",
      created_at: createdAt,
    },
  };
}

const OLDER = "2026-01-01T00:00:00.000Z";
const NEWER = "2026-06-01T00:00:00.000Z";

describe("orderSearchResults", () => {
  it("orders newest meeting first, then meeting id, then start_ms", () => {
    const ordered = orderSearchResults([
      result("m-old", OLDER, 5000),
      result("m-old", OLDER, 0),
      result("m-new", NEWER, 9000),
    ]);
    expect(ordered.map((r) => r.meeting.id)).toEqual(["m-new", "m-old", "m-old"]);
    const olderStarts = ordered
      .filter((r) => r.meeting.id === "m-old")
      .map((r) => r.utterance.start_ms);
    expect(olderStarts).toEqual([0, 5000]);
  });

  it("places the newest meeting's hit first so a later slice can't drop it (Bug 2)", () => {
    // Older meeting has many low-start_ms hits; the newer meeting's single hit
    // has a high start_ms. A start_ms-first ordering (the old DB query) would
    // truncate the newer hit out; recency ordering must keep it on top.
    const top = orderSearchResults([
      result("m-old", OLDER, 0),
      result("m-old", OLDER, 1000),
      result("m-old", OLDER, 2000),
      result("m-new", NEWER, 999999),
    ]).slice(0, 1);
    expect(top).toHaveLength(1);
    expect(top[0].meeting.id).toBe("m-new");
  });

  it("does not mutate its input", () => {
    const input = [result("b", NEWER, 0), result("a", OLDER, 0)];
    const snapshot = input.map((r) => r.meeting.id);
    orderSearchResults(input);
    expect(input.map((r) => r.meeting.id)).toEqual(snapshot);
  });
});
