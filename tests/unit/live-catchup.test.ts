// Live "catch me up" recap: the pure refresh gate, the best-effort rolling
// refresh, and the live poll route surfacing the recap.
//
// Same harness as live-transcription.test.ts: MOCK_MODE=true, a unique
// DATA_DIR, and the global store/providers singletons cleared so getStore() /
// getProviders() rebind to this test's dataDir (the route handler and our
// seeding share one store, and the mock provider is deterministic).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shouldRefreshCatchUp, nextRecapWindow } from "@/lib/live/catchup";
import type { Meeting } from "@/lib/types";

let dataDir: string;

function clearStoreSingleton() {
  const g = globalThis as unknown as {
    __civicscribeStore?: unknown;
    __civicscribeFiles?: unknown;
    __civicscribeProviders?: unknown;
  };
  delete g.__civicscribeStore;
  delete g.__civicscribeFiles;
  delete g.__civicscribeProviders;
}

beforeEach(async () => {
  vi.resetModules();
  const { makeTempDataDir } = await import("./helpers");
  dataDir = await makeTempDataDir();
  process.env.MOCK_MODE = "true";
  process.env.DATA_DIR = dataDir;
  delete process.env.RECALL_WEBHOOK_SECRET;
  clearStoreSingleton();
});

afterEach(async () => {
  delete process.env.MOCK_MODE;
  delete process.env.DATA_DIR;
  clearStoreSingleton();
  vi.resetModules();
  const { cleanupDataDir } = await import("./helpers");
  await cleanupDataDir(dataDir);
});

/** Seed a live-enabled meeting in status "capturing". */
async function seedLiveMeeting(overrides: Record<string, unknown> = {}) {
  const { getStore } = await import("@/lib/store");
  const store = getStore();
  const m = await store.createMeeting({
    title: "Council Live Session",
    body_name: "City Council",
    source_type: "zoom",
    source_url: "https://us02web.zoom.us/j/cu",
    live_enabled: true,
    ...overrides,
  });
  await store.setMeetingStatus(m.id, "capturing");
  return store.getMeeting(m.id) as Promise<Meeting>;
}

/** Minimal Meeting for the pure-gate tests: only the fields the gate reads. */
function meetingForGate(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "T",
    body_name: "B",
    source_type: "zoom",
    kind: "civic",
    source_url: null,
    status: "capturing",
    error_message: null,
    scheduled_at: null,
    audio_storage_path: null,
    duration_seconds: null,
    schedule_id: null,
    occurrence_key: null,
    attestation: null,
    publish_requested_at: null,
    published: false,
    published_at: null,
    tenant_id: null,
    source_key: null,
    live_enabled: true,
    live_started_at: null,
    live_ended_at: null,
    live_summary: null,
    live_summary_through_id: null,
    live_summary_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("shouldRefreshCatchUp (pure gate)", () => {
  const now = Date.now();

  it("returns false when the recap is fresh (live_summary_at recent)", () => {
    const m = meetingForGate({
      live_summary_through_id: 0,
      live_summary_at: new Date(now - 1_000).toISOString(),
    });
    // New lines exist (latest 5 > through 0) but the recap was just generated.
    expect(shouldRefreshCatchUp(m, 5, now)).toBe(false);
  });

  it("returns true when live_summary_at is null and there are new lines", () => {
    const m = meetingForGate({
      live_summary_through_id: null,
      live_summary_at: null,
    });
    expect(shouldRefreshCatchUp(m, 3, now)).toBe(true);
  });

  it("returns false when there are no new lines (latest <= through_id)", () => {
    const m = meetingForGate({
      live_summary_through_id: 10,
      live_summary_at: null,
    });
    expect(shouldRefreshCatchUp(m, 10, now)).toBe(false);
  });

  it("returns false when status is not capturing", () => {
    const m = meetingForGate({
      status: "transcribing",
      live_summary_through_id: null,
      live_summary_at: null,
    });
    expect(shouldRefreshCatchUp(m, 3, now)).toBe(false);
  });

  it("returns true when the recap is stale (older than the interval)", () => {
    const m = meetingForGate({
      live_summary_through_id: 0,
      live_summary_at: new Date(now - 200_000).toISOString(),
    });
    expect(shouldRefreshCatchUp(m, 5, now)).toBe(true);
  });
});

describe("nextRecapWindow (contiguous, no skip)", () => {
  it("returns all lines and the last id when within maxLines", () => {
    const { window, coveredThroughId } = nextRecapWindow(
      [{ id: 5 }, { id: 6 }, { id: 7 }],
      10
    );
    expect(window.map((w) => w.id)).toEqual([5, 6, 7]);
    expect(coveredThroughId).toBe(7);
  });

  it("takes the OLDEST maxLines and advances the cursor only to that chunk", () => {
    // Regression: the backlog must roll forward contiguously. The cursor must be
    // 2 (end of the covered chunk), NOT 5 — lines 3,4,5 are covered next refresh,
    // never skipped.
    const { window, coveredThroughId } = nextRecapWindow(
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      2
    );
    expect(window.map((w) => w.id)).toEqual([1, 2]);
    expect(coveredThroughId).toBe(2);
  });
});

describe("maybeRefreshCatchUp", () => {
  it("persists the recap and advances live_summary_through_id to the latest line", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const { getProviders } = await import("@/lib/providers");
    const { maybeRefreshCatchUp } = await import("@/lib/live/catchup");
    const store = getStore();

    await store.appendLiveUtterance(m.id, { text: "Good evening." });
    await store.appendLiveUtterance(m.id, { text: "We have a quorum." });
    const last = await store.appendLiveUtterance(m.id, {
      text: "Item one is the budget.",
    });

    await maybeRefreshCatchUp(m, store, getProviders());

    const updated = await store.getMeeting(m.id);
    expect(updated?.live_summary).not.toBeNull();
    expect(updated?.live_summary).toContain("3 new line");
    expect(updated?.live_summary_through_id).toBe(last.id);
    expect(updated?.live_summary_at).not.toBeNull();
  });

  it("is a no-op on an immediate second call (timestamp now fresh)", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const { getProviders } = await import("@/lib/providers");
    const { maybeRefreshCatchUp } = await import("@/lib/live/catchup");
    const store = getStore();

    await store.appendLiveUtterance(m.id, { text: "Line one." });
    await maybeRefreshCatchUp(m, store, getProviders());

    const afterFirst = await store.getMeeting(m.id);
    const summaryAfterFirst = afterFirst!.live_summary;

    // Add a new line and call again with the SAME (stale) meeting object: the
    // fresh live_summary_at persisted by the first call gates the second.
    await store.appendLiveUtterance(m.id, { text: "Line two." });
    await maybeRefreshCatchUp(afterFirst!, store, getProviders());

    const afterSecond = await store.getMeeting(m.id);
    // through_id did not advance past the first refresh (the gate skipped).
    expect(afterSecond?.live_summary_through_id).toBe(
      afterFirst?.live_summary_through_id
    );
    expect(afterSecond?.live_summary).toBe(summaryAfterFirst);
  });

  it("does nothing when there are no live lines", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const { getProviders } = await import("@/lib/providers");
    const { maybeRefreshCatchUp } = await import("@/lib/live/catchup");
    const store = getStore();

    await maybeRefreshCatchUp(m, store, getProviders());

    const updated = await store.getMeeting(m.id);
    expect(updated?.live_summary).toBeNull();
    expect(updated?.live_summary_through_id).toBeNull();
    expect(updated?.live_summary_at).toBeNull();
  });

  it("generates only once under concurrent pollers (in-process claim)", async () => {
    // Regression: two pollers sharing the same stale snapshot must not both call
    // the LLM. The in-process guard lets exactly one win.
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const { maybeRefreshCatchUp } = await import("@/lib/live/catchup");
    const store = getStore();

    await store.appendLiveUtterance(m.id, { text: "Line one." });
    await store.appendLiveUtterance(m.id, { text: "Line two." });

    let calls = 0;
    const providers = {
      summary: {
        async catchUp() {
          calls += 1;
          return "recap";
        },
      },
    } as unknown as import("@/lib/providers/types").Providers;

    await Promise.all([
      maybeRefreshCatchUp(m, store, providers),
      maybeRefreshCatchUp(m, store, providers),
    ]);

    expect(calls).toBe(1);
  });
});

describe("GET /api/meetings/[id]/live — catchUp in the body", () => {
  it("returns catchUp: null before any recap exists", async () => {
    const m = await seedLiveMeeting();
    const { GET } = await import("@/app/api/meetings/[id]/live/route");
    const res = await GET(
      new Request(`https://example.test/api/meetings/${m.id}/live`),
      { params: Promise.resolve({ id: m.id }) }
    );
    const body = (await res.json()) as { catchUp: unknown };
    expect(body.catchUp).toBeNull();
  });

  it("returns the recap once one exists", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    await store.updateMeeting(m.id, {
      live_summary: "Here is what you missed so far.",
      live_summary_through_id: 0,
      live_summary_at: new Date().toISOString(),
    });

    const { GET } = await import("@/app/api/meetings/[id]/live/route");
    const res = await GET(
      new Request(`https://example.test/api/meetings/${m.id}/live`),
      { params: Promise.resolve({ id: m.id }) }
    );
    const body = (await res.json()) as {
      catchUp: { text: string; updatedAt: string | null } | null;
    };
    expect(body.catchUp).not.toBeNull();
    expect(body.catchUp?.text).toBe("Here is what you missed so far.");
    expect(body.catchUp?.updatedAt).not.toBeNull();
  });
});
