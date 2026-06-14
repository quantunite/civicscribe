// MemoryStore round-trip for the Phase 3 topic-synthesis cache: getTopicSynthesis
// returns null when absent, upsertTopicSynthesis stores all fields (including the
// sourceMeetingIds array), upserting the same slug replaces rather than
// duplicates, and the row persists across a fresh MemoryStore on the same dataDir.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import type { TopicSynthesis } from "@/lib/types";
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

function synthesis(overrides: Partial<TopicSynthesis> = {}): TopicSynthesis {
  return {
    slug: "zoning",
    topic: "Zoning",
    content: "## Synthesis: Zoning\n\nWhat changed over time.",
    sourceMeetingIds: ["id-a", "id-b"],
    meetingCount: 2,
    model: "claude-sonnet-4-6",
    generatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("MemoryStore topic-synthesis cache", () => {
  it("returns null when no synthesis exists for a slug", async () => {
    expect(await store.getTopicSynthesis("zoning")).toBeNull();
  });

  it("round-trips every field after an upsert", async () => {
    const rec = synthesis();
    await store.upsertTopicSynthesis(rec);

    const got = await store.getTopicSynthesis("zoning");
    expect(got).toEqual(rec);
    // sourceMeetingIds is a distinct array copy, not a shared reference.
    expect(got?.sourceMeetingIds).toEqual(["id-a", "id-b"]);
  });

  it("preserves a null model", async () => {
    await store.upsertTopicSynthesis(synthesis({ model: null }));
    const got = await store.getTopicSynthesis("zoning");
    expect(got?.model).toBeNull();
  });

  it("replaces the existing row on a second upsert of the same slug", async () => {
    await store.upsertTopicSynthesis(synthesis({ content: "first" }));
    await store.upsertTopicSynthesis(
      synthesis({ content: "second", sourceMeetingIds: ["id-a", "id-b", "id-c"], meetingCount: 3 })
    );

    const got = await store.getTopicSynthesis("zoning");
    expect(got?.content).toBe("second");
    expect(got?.sourceMeetingIds).toEqual(["id-a", "id-b", "id-c"]);
    expect(got?.meetingCount).toBe(3);
  });

  it("keeps syntheses for different slugs independent", async () => {
    await store.upsertTopicSynthesis(synthesis({ slug: "zoning", topic: "Zoning" }));
    await store.upsertTopicSynthesis(synthesis({ slug: "budget", topic: "Budget" }));

    expect((await store.getTopicSynthesis("zoning"))?.topic).toBe("Zoning");
    expect((await store.getTopicSynthesis("budget"))?.topic).toBe("Budget");
  });

  it("persists across a fresh MemoryStore on the same dataDir", async () => {
    await store.upsertTopicSynthesis(synthesis());
    const reopened = new MemoryStore(dataDir);
    expect(await reopened.getTopicSynthesis("zoning")).toEqual(synthesis());
  });

  it("does not let a caller mutate stored state through the returned object", async () => {
    await store.upsertTopicSynthesis(synthesis());
    const got = await store.getTopicSynthesis("zoning");
    got!.sourceMeetingIds.push("tampered");
    got!.content = "tampered";

    const again = await store.getTopicSynthesis("zoning");
    expect(again?.sourceMeetingIds).toEqual(["id-a", "id-b"]);
    expect(again?.content).toBe("## Synthesis: Zoning\n\nWhat changed over time.");
  });
});
