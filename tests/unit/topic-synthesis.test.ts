// getOrBuildTopicSynthesis: the cross-meeting synthesis cache + the #1 cost-safety
// invariant. A non-admin (allowGenerate:false) request must NEVER call the
// provider; only an admin (allowGenerate:true) request may generate. Covers
// too_few, absent, stale, generated, fresh, and cache invalidation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { getOrBuildTopicSynthesis } from "@/lib/topics/synthesis";
import type { Providers, TopicSynthesisInput } from "@/lib/providers/types";
import type { MeetingSummaryContent } from "@/lib/types";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;
let synthSpy: ReturnType<typeof vi.fn>;

const SLUG = "zoning";

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
  synthSpy = vi.fn(async (_input: TopicSynthesisInput) => "GENERATED SYNTHESIS");
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

/** A Providers object whose only live method is summary.synthesizeTopic (the spy).
 *  Everything else is a poison pill: the lib must never touch them. */
function fakeProviders(): Providers {
  return {
    summary: {
      summarize: vi.fn(),
      synthesizeTopic: synthSpy,
    },
  } as unknown as Providers;
}

let urlSeed = 0;
function uniqueYoutubeUrl(): string {
  const id = `vid${String(urlSeed++).padStart(8, "0")}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

function summary(topics: string[], keyDecisions: string[]): MeetingSummaryContent {
  return {
    overview: `Overview about ${topics.join(", ")}`,
    key_decisions: keyDecisions,
    action_items: [],
    topics,
    full_markdown: "# md",
  };
}

async function seedMeeting(opts: {
  title: string;
  topics: string[];
  keyDecisions?: string[];
  published?: boolean;
}) {
  const m = await store.createMeeting({
    title: opts.title,
    body_name: "City Council",
    source_type: "stream",
    source_url: uniqueYoutubeUrl(),
  });
  await store.createSummary(m.id, summary(opts.topics, opts.keyDecisions ?? []));
  if (opts.published !== false) await store.publishMeeting(m.id);
  return m;
}

describe("getOrBuildTopicSynthesis: status logic", () => {
  it("returns too_few with no provider call when fewer than 2 published meetings", async () => {
    await seedMeeting({ title: "A", topics: ["Zoning"] });

    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });

    expect(result.status).toBe("too_few");
    expect(result.content).toBeNull();
    expect(result.meetings).toHaveLength(1);
    expect(synthSpy).not.toHaveBeenCalled();
  });

  it("resolves the topic label from the meetings' raw topic spelling", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    await seedMeeting({ title: "B", topics: ["Public Safety"] });

    const result = await getOrBuildTopicSynthesis(
      store,
      fakeProviders(),
      "public-safety",
      { allowGenerate: false }
    );

    expect(result.topic).toBe("Public Safety");
  });
});

describe("getOrBuildTopicSynthesis: COST SAFETY (public, allowGenerate:false)", () => {
  it("NEVER calls the provider and returns absent when there is no cache", async () => {
    await seedMeeting({ title: "A", topics: ["Zoning"] });
    await seedMeeting({ title: "B", topics: ["Zoning"] });

    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: false,
    });

    expect(result.status).toBe("absent");
    expect(result.content).toBeNull();
    expect(synthSpy).not.toHaveBeenCalled();
    // And nothing was written to the cache.
    expect(await store.getTopicSynthesis(SLUG)).toBeNull();
  });

  it("returns the stale cached content WITHOUT calling the provider when the set changed", async () => {
    const a = await seedMeeting({ title: "A", topics: ["Zoning"] });
    const b = await seedMeeting({ title: "B", topics: ["Zoning"] });
    // Pre-seed a synthesis built from only {a, b}.
    await store.upsertTopicSynthesis({
      slug: SLUG,
      topic: "Zoning",
      content: "OLD CACHED",
      sourceMeetingIds: [a.id, b.id].sort(),
      meetingCount: 2,
      model: "claude-sonnet-4-6",
      generatedAt: "2026-06-01T00:00:00.000Z",
    });
    // Now a third published meeting joins the topic: the cache is stale.
    await seedMeeting({ title: "C", topics: ["Zoning"] });

    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: false,
    });

    expect(result.status).toBe("stale");
    expect(result.content).toBe("OLD CACHED");
    expect(synthSpy).not.toHaveBeenCalled();
  });
});

describe("getOrBuildTopicSynthesis: admin generation (allowGenerate:true)", () => {
  it("generates, caches, and returns generated when there is no cache", async () => {
    const a = await seedMeeting({
      title: "A",
      topics: ["Zoning"],
      keyDecisions: ["Approved variance (5-2)"],
    });
    const b = await seedMeeting({
      title: "B",
      topics: ["Zoning"],
      keyDecisions: ["Tabled overlay"],
    });

    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });

    expect(result.status).toBe("generated");
    expect(result.content).toBe("GENERATED SYNTHESIS");
    expect(synthSpy).toHaveBeenCalledTimes(1);

    // The provider was handed the topic + per-meeting {title,date,overview,keyPoints}.
    const passed = synthSpy.mock.calls[0][0] as TopicSynthesisInput;
    expect(passed.topic).toBe("Zoning");
    expect(passed.meetings).toHaveLength(2);
    const keyPointSets = passed.meetings.map((m) => m.keyPoints);
    expect(keyPointSets).toContainEqual(["Approved variance (5-2)"]);
    expect(keyPointSets).toContainEqual(["Tabled overlay"]);

    // The cache now holds the synthesis keyed by the sorted current id set.
    const cached = await store.getTopicSynthesis(SLUG);
    expect(cached).not.toBeNull();
    expect(cached?.content).toBe("GENERATED SYNTHESIS");
    expect(cached?.sourceMeetingIds).toEqual([a.id, b.id].sort());
    expect(cached?.meetingCount).toBe(2);
  });

  it("returns fresh without regenerating when the cache matches the current set", async () => {
    await seedMeeting({ title: "A", topics: ["Zoning"] });
    await seedMeeting({ title: "B", topics: ["Zoning"] });

    // First call generates.
    await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });
    expect(synthSpy).toHaveBeenCalledTimes(1);

    // Second call (even with generate allowed) is a cache hit: no new call.
    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });
    expect(result.status).toBe("fresh");
    expect(result.content).toBe("GENERATED SYNTHESIS");
    expect(result.generatedAt).toBeDefined();
    expect(synthSpy).toHaveBeenCalledTimes(1);
  });

  it("returns fresh for a public reader once an admin has generated", async () => {
    await seedMeeting({ title: "A", topics: ["Zoning"] });
    await seedMeeting({ title: "B", topics: ["Zoning"] });
    await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });

    const publicView = await getOrBuildTopicSynthesis(
      store,
      fakeProviders(),
      SLUG,
      { allowGenerate: false }
    );
    expect(publicView.status).toBe("fresh");
    expect(publicView.content).toBe("GENERATED SYNTHESIS");
    expect(synthSpy).toHaveBeenCalledTimes(1);
  });

  it("regenerates when the published set for the slug changes (invalidation)", async () => {
    await seedMeeting({ title: "A", topics: ["Zoning"] });
    await seedMeeting({ title: "B", topics: ["Zoning"] });
    await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });
    expect(synthSpy).toHaveBeenCalledTimes(1);

    // Publishing a new meeting on the topic changes the id set: stale -> regen.
    const c = await seedMeeting({ title: "C", topics: ["Zoning"] });

    const result = await getOrBuildTopicSynthesis(store, fakeProviders(), SLUG, {
      allowGenerate: true,
    });
    expect(result.status).toBe("generated");
    expect(synthSpy).toHaveBeenCalledTimes(2);

    const cached = await store.getTopicSynthesis(SLUG);
    expect(cached?.sourceMeetingIds).toContain(c.id);
    expect(cached?.meetingCount).toBe(3);
  });
});
