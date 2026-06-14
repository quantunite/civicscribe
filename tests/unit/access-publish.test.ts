// Phase 0 access/publish data model on MemoryStore: createMeeting sets
// published=false + a computed source_key, findBySourceKey dedups, publish /
// unpublish flip the flag + timestamp, listLibrary returns published-only, and
// listPendingReview returns the moderation queue. Plus: legacy db.json rows
// written before these columns existed coalesce to safe defaults on load().

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

function newMeeting(overrides: Record<string, unknown> = {}) {
  return {
    title: "T",
    body_name: "City Council",
    source_type: "stream" as const,
    source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ...overrides,
  };
}

describe("createMeeting — publish + source_key defaults", () => {
  it("defaults published=false / published_at=null / tenant_id=null", async () => {
    const m = await store.createMeeting(newMeeting());
    expect(m.published).toBe(false);
    expect(m.published_at).toBeNull();
    expect(m.tenant_id).toBeNull();
  });

  it("computes source_key from source_url", async () => {
    const m = await store.createMeeting(newMeeting());
    expect(m.source_key).toBe("youtube:dQw4w9WgXcQ");
  });

  it("source_key is null when there is no source_url", async () => {
    const m = await store.createMeeting(
      newMeeting({ source_type: "upload", source_url: null })
    );
    expect(m.source_key).toBeNull();
  });

  it("honors an explicit source_key override", async () => {
    const m = await store.createMeeting(
      newMeeting({ source_key: "custom:abc" })
    );
    expect(m.source_key).toBe("custom:abc");
  });
});

describe("findBySourceKey — dedup", () => {
  it("finds the meeting that shares a normalized source url", async () => {
    const created = await store.createMeeting(newMeeting());
    // A different youtube URL shape for the same video must dedup to it.
    const found = await store.findBySourceKey(
      "youtube:dQw4w9WgXcQ"
    );
    expect(found?.id).toBe(created.id);
  });

  it("returns null for an unknown key and for null/empty input", async () => {
    await store.createMeeting(newMeeting());
    expect(await store.findBySourceKey("youtube:zzzzzzzzzzz")).toBeNull();
    expect(await store.findBySourceKey(null)).toBeNull();
    expect(await store.findBySourceKey("")).toBeNull();
  });
});

describe("createMeeting — source_key uniqueness (race backstop parity)", () => {
  it("short-circuits a same-source create to the existing meeting", async () => {
    // The partial UNIQUE index on source_key means a second identical submit
    // must not create a second row (and double-spend on generation). MemoryStore
    // short-circuits to the existing meeting, mirroring the Supabase backstop's
    // re-read-on-unique-violation outcome.
    const first = await store.createMeeting(newMeeting({ title: "first" }));
    const second = await store.createMeeting(newMeeting({ title: "second" }));

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("first"); // existing row, not a new one
    expect(await store.listMeetings()).toHaveLength(1);
    // A different youtube URL shape for the same video dedups to the same row.
    const third = await store.createMeeting(
      newMeeting({ title: "third", source_url: "https://youtu.be/dQw4w9WgXcQ" })
    );
    expect(third.id).toBe(first.id);
    expect(await store.listMeetings()).toHaveLength(1);
  });

  it("null source_key (uploads) never dedups", async () => {
    const a = await store.createMeeting(
      newMeeting({ source_type: "upload", source_url: null })
    );
    const b = await store.createMeeting(
      newMeeting({ source_type: "upload", source_url: null })
    );
    expect(b.id).not.toBe(a.id);
    expect(await store.listMeetings()).toHaveLength(2);
  });

  it("two concurrent identical creates yield a single row (race backstop)", async () => {
    // Fire both before awaiting either: the store serializes them, so the second
    // sees the first's row and short-circuits instead of double-spending. Only
    // one meeting must exist and both calls must resolve to the same id.
    const [a, b] = await Promise.all([
      store.createMeeting(newMeeting({ title: "racer-1" })),
      store.createMeeting(newMeeting({ title: "racer-2" })),
    ]);
    expect(a.id).toBe(b.id);
    expect(await store.listMeetings()).toHaveLength(1);
  });
});

describe("publishMeeting / unpublishMeeting", () => {
  it("publish sets published=true + a published_at timestamp", async () => {
    const m = await store.createMeeting(newMeeting());
    const published = await store.publishMeeting(m.id);
    expect(published.published).toBe(true);
    expect(published.published_at).not.toBeNull();
  });

  it("re-publishing is idempotent and keeps the original published_at", async () => {
    const m = await store.createMeeting(newMeeting());
    const first = await store.publishMeeting(m.id);
    const again = await store.publishMeeting(m.id);
    expect(again.published).toBe(true);
    expect(again.published_at).toBe(first.published_at);
  });

  it("unpublish clears published + published_at", async () => {
    const m = await store.createMeeting(newMeeting());
    await store.publishMeeting(m.id);
    const unpublished = await store.unpublishMeeting(m.id);
    expect(unpublished.published).toBe(false);
    expect(unpublished.published_at).toBeNull();
  });

  it("throws for an unknown meeting id", async () => {
    await expect(store.publishMeeting("nope")).rejects.toThrow();
    await expect(store.unpublishMeeting("nope")).rejects.toThrow();
  });
});

describe("listLibrary — published only, newest first", () => {
  it("excludes unpublished meetings", async () => {
    // Distinct source_urls: each meeting has its own dedup key so they coexist
    // (the partial UNIQUE index on source_key now collapses same-source rows).
    const a = await store.createMeeting(
      newMeeting({ title: "A", source_url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" })
    );
    await store.createMeeting(
      newMeeting({ title: "B", source_url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" })
    );
    await store.publishMeeting(a.id);

    const lib = await store.listLibrary();
    expect(lib.map((m) => m.title)).toEqual(["A"]);
  });

  it("filters by kind when given", async () => {
    const civic = await store.createMeeting(
      newMeeting({
        title: "Civic",
        kind: "civic",
        source_url: "https://www.youtube.com/watch?v=ccccccccccc",
      })
    );
    const course = await store.createMeeting(
      newMeeting({
        title: "Course",
        kind: "course",
        source_url: "https://www.youtube.com/watch?v=ddddddddddd",
      })
    );
    await store.publishMeeting(civic.id);
    await store.publishMeeting(course.id);

    expect((await store.listLibrary({ kind: "course" })).map((m) => m.title)).toEqual(
      ["Course"]
    );
    expect((await store.listLibrary({ kind: "civic" })).map((m) => m.title)).toEqual(
      ["Civic"]
    );
    expect(await store.listLibrary()).toHaveLength(2);
  });
});

describe("listPendingReview — moderation queue", () => {
  it("returns unpublished, non-failed meetings only", async () => {
    await store.createMeeting(
      newMeeting({ title: "pending", source_url: "https://www.youtube.com/watch?v=eeeeeeeeeee" })
    );
    const published = await store.createMeeting(
      newMeeting({ title: "published", source_url: "https://www.youtube.com/watch?v=fffffffffff" })
    );
    const failed = await store.createMeeting(
      newMeeting({ title: "failed", source_url: "https://www.youtube.com/watch?v=ggggggggggg" })
    );
    await store.publishMeeting(published.id);
    await store.setMeetingStatus(failed.id, "failed", "boom");

    const queue = await store.listPendingReview();
    expect(queue.map((m) => m.title)).toEqual(["pending"]);
  });
});

describe("MemoryStore.load() — legacy-row coalesce of new fields", () => {
  it("coalesces missing published / published_at / tenant_id / source_key", async () => {
    // A db.json row written before migration 0006 carried none of the new
    // columns. load() must coalesce them so the rest of the app never sees
    // undefined.
    const legacyId = randomUUID();
    const db = {
      meetings: [
        {
          id: legacyId,
          title: "legacy",
          body_name: "Old Body",
          source_type: "stream",
          source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          status: "complete",
          error_message: null,
          scheduled_at: null,
          audio_storage_path: null,
          duration_seconds: null,
          created_at: "2026-01-01T00:00:00.000Z",
          // intentionally: no kind, schedule_id, occurrence_key, published,
          // published_at, tenant_id, source_key.
        },
      ],
      transcripts: [],
      utterances: [],
      summaries: [],
      speaker_aliases: [],
      jobs: [],
      schedules: [],
    };
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "db.json"),
      JSON.stringify(db, null, 2),
      "utf8"
    );

    const m = await store.getMeeting(legacyId);
    expect(m).not.toBeNull();
    expect(m?.published).toBe(false);
    expect(m?.published_at).toBeNull();
    expect(m?.tenant_id).toBeNull();
    // source_key is back-filled from the legacy source_url so old rows dedup too.
    expect(m?.source_key).toBe("youtube:dQw4w9WgXcQ");
    // and the pre-existing kind coalesce still holds.
    expect(m?.kind).toBe("civic");
  });
});
