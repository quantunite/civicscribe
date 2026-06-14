// Phase 2 topic browse on MemoryStore: listTopics aggregates summaries.topics
// across PUBLISHED meetings only into { topic, slug, count } buckets, and
// getTopicMeetings returns the published meetings for a slug newest first.
// Unpublished meetings must never leak through either surface.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { topicSlug } from "@/lib/topics";
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

let urlSeed = 0;
function uniqueYoutubeUrl(): string {
  // 11-char ids the sourceKey extractor accepts, distinct per meeting so each
  // gets its own dedup key and they coexist.
  const id = `vid${String(urlSeed++).padStart(8, "0")}`;
  return `https://www.youtube.com/watch?v=${id}`;
}

function summary(topics: string[]): MeetingSummaryContent {
  return {
    overview: `Overview about ${topics.join(", ")}`,
    key_decisions: [],
    action_items: [],
    topics,
    full_markdown: "# md",
  };
}

/** Create a meeting + its summary; publish it unless published=false. */
async function seedMeeting(opts: {
  title: string;
  topics: string[];
  published?: boolean;
}) {
  const m = await store.createMeeting({
    title: opts.title,
    body_name: "City Council",
    source_type: "stream",
    source_url: uniqueYoutubeUrl(),
  });
  await store.createSummary(m.id, summary(opts.topics));
  if (opts.published !== false) await store.publishMeeting(m.id);
  return m;
}

describe("listTopics — published-only aggregation", () => {
  it("counts distinct published meetings per topic", async () => {
    await seedMeeting({ title: "A", topics: ["zoning", "budget"] });
    await seedMeeting({ title: "B", topics: ["zoning"] });
    await seedMeeting({ title: "C", topics: ["budget", "parks"] });

    const topics = await store.listTopics();
    const byTopic = new Map(topics.map((t) => [t.topic, t.count]));
    expect(byTopic.get("zoning")).toBe(2);
    expect(byTopic.get("budget")).toBe(2);
    expect(byTopic.get("parks")).toBe(1);
  });

  it("carries the slug for each topic", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    const topics = await store.listTopics();
    const t = topics.find((x) => x.slug === "public-safety");
    expect(t).toBeDefined();
    expect(t?.slug).toBe(topicSlug("Public Safety"));
  });

  it("excludes topics that only appear on unpublished meetings", async () => {
    await seedMeeting({ title: "pub", topics: ["zoning"] });
    await seedMeeting({ title: "draft", topics: ["secret-topic"], published: false });

    const topics = await store.listTopics();
    expect(topics.map((t) => t.slug)).toContain("zoning");
    expect(topics.map((t) => t.slug)).not.toContain("secret-topic");
  });

  it("does not double-count a meeting that lists the same slug twice", async () => {
    // Two raw spellings that slugify to the same bucket on one meeting must
    // count as a single meeting for that slug.
    await seedMeeting({ title: "A", topics: ["Public Safety", "public-safety"] });
    const topics = await store.listTopics();
    const t = topics.find((x) => x.slug === "public-safety");
    expect(t?.count).toBe(1);
  });

  it("collapses case/punctuation variants across meetings into one bucket", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    await seedMeeting({ title: "B", topics: ["public safety"] });
    const topics = await store.listTopics();
    const matching = topics.filter((x) => x.slug === "public-safety");
    expect(matching).toHaveLength(1);
    expect(matching[0].count).toBe(2);
  });

  it("orders by count desc, then topic asc", async () => {
    await seedMeeting({ title: "A", topics: ["alpha", "zeta"] });
    await seedMeeting({ title: "B", topics: ["alpha", "zeta"] });
    await seedMeeting({ title: "C", topics: ["alpha"] });
    // alpha=3, zeta=2; among equal counts, topic asc.
    await seedMeeting({ title: "D", topics: ["mid"] });
    // zeta=2, mid=1 — but add one so two share count 2 to test the tiebreak.
    await seedMeeting({ title: "E", topics: ["mid"] });

    const topics = await store.listTopics();
    expect(topics.map((t) => t.topic)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("returns [] when nothing is published", async () => {
    await seedMeeting({ title: "draft", topics: ["zoning"], published: false });
    expect(await store.listTopics()).toEqual([]);
  });
});

describe("getTopicMeetings — published-only, newest first", () => {
  it("returns published meetings carrying the slug, newest first", async () => {
    const a = await seedMeeting({ title: "A", topics: ["zoning"] });
    const b = await seedMeeting({ title: "B", topics: ["zoning"] });
    const c = await seedMeeting({ title: "C", topics: ["budget"] });

    const rows = await store.getTopicMeetings("zoning");
    const ids = rows.map((r) => r.meeting.id);
    // Newest first: B was created after A.
    expect(ids).toEqual([b.id, a.id]);
    expect(ids).not.toContain(c.id);
  });

  it("matches case/punctuation variants of the slug", async () => {
    await seedMeeting({ title: "A", topics: ["Public Safety"] });
    const rows = await store.getTopicMeetings("public-safety");
    expect(rows.map((r) => r.meeting.title)).toEqual(["A"]);
  });

  it("never returns unpublished meetings", async () => {
    await seedMeeting({ title: "pub", topics: ["zoning"] });
    await seedMeeting({ title: "draft", topics: ["zoning"], published: false });
    const rows = await store.getTopicMeetings("zoning");
    expect(rows.map((r) => r.meeting.title)).toEqual(["pub"]);
  });

  it("carries the summary fields a card needs", async () => {
    await seedMeeting({ title: "A", topics: ["zoning", "budget"] });
    const rows = await store.getTopicMeetings("zoning");
    expect(rows[0].overview).toContain("zoning");
    expect(rows[0].topics).toEqual(["zoning", "budget"]);
  });

  it("returns [] for an unknown or empty slug", async () => {
    await seedMeeting({ title: "A", topics: ["zoning"] });
    expect(await store.getTopicMeetings("nope")).toEqual([]);
    expect(await store.getTopicMeetings("")).toEqual([]);
  });
});
