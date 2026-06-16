// Live transcription (polling) — store methods, the webhook ingest path, the
// public live poll endpoint, and the createMeeting opt-in default.
//
// Uses the MemoryStore + temp-dataDir pattern: MOCK_MODE=true, a unique
// DATA_DIR, and the global store singleton cleared so getStore() rebinds to this
// test's dataDir (so the route handlers and our seeding share one store).
// RECALL_WEBHOOK_SECRET is left unset so the webhook route is open, matching how
// the other route tests leave secrets unset.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir: string;

function clearStoreSingleton() {
  const g = globalThis as unknown as {
    __civicscribeStore?: unknown;
    __civicscribeFiles?: unknown;
  };
  delete g.__civicscribeStore;
  delete g.__civicscribeFiles;
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
    source_url: "https://us02web.zoom.us/j/123",
    live_enabled: true,
    ...overrides,
  });
  await store.setMeetingStatus(m.id, "capturing");
  return m;
}

/** Build a Recall transcript.data webhook body for a finalized utterance. NOTE
 *  the double nesting: words/participant live at data.data.*, bot at data.* . */
function transcriptDataBody(opts: {
  meetingId: string;
  words: string[];
  participantId?: number;
  participantName?: string | null;
  firstRelative?: number;
}) {
  return {
    event: "transcript.data",
    data: {
      data: {
        words: opts.words.map((text, i) => ({
          text,
          start_timestamp: { relative: opts.firstRelative ?? 0 + i },
          end_timestamp: { relative: (opts.firstRelative ?? 0) + i + 1 },
        })),
        participant: {
          id: opts.participantId ?? 1,
          name: opts.participantName ?? null,
        },
      },
      bot: {
        id: "bot-abc",
        metadata: { civicscribe_meeting_id: opts.meetingId },
      },
    },
  };
}

function webhookReq(body: unknown): Request {
  return new Request("https://example.test/api/webhooks/recall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("MemoryStore live utterances", () => {
  it("appendLiveUtterance then listLiveUtterances returns it", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const store = getStore();

    const u = await store.appendLiveUtterance(m.id, {
      speaker_label: "Alice",
      text: "Good evening everyone",
      ts_seconds: 1.5,
    });
    expect(u.id).toBeGreaterThan(0);

    const all = await store.listLiveUtterances(m.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      meeting_id: m.id,
      speaker_label: "Alice",
      text: "Good evening everyone",
      ts_seconds: 1.5,
    });
  });

  it("listLiveUtterances(meetingId, sinceId) filters by id > sinceId", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const store = getStore();

    const a = await store.appendLiveUtterance(m.id, { text: "one" });
    const b = await store.appendLiveUtterance(m.id, { text: "two" });
    const c = await store.appendLiveUtterance(m.id, { text: "three" });

    const sinceA = await store.listLiveUtterances(m.id, a.id);
    expect(sinceA.map((u) => u.id)).toEqual([b.id, c.id]);

    const sinceC = await store.listLiveUtterances(m.id, c.id);
    expect(sinceC).toHaveLength(0);
  });

  it("listLiveMeetings returns only live_enabled meetings in status capturing", async () => {
    const { getStore } = await import("@/lib/store");
    const store = getStore();

    const live = await seedLiveMeeting({ title: "Live one" });
    // live_enabled but NOT capturing -> excluded.
    await store.createMeeting({
      title: "Live but pending",
      body_name: "City Council",
      source_type: "zoom",
      source_url: "https://us02web.zoom.us/j/pending",
      live_enabled: true,
    });
    // capturing but NOT live_enabled -> excluded.
    const notLive = await store.createMeeting({
      title: "Capturing not live",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://example.test/notlive",
    });
    await store.setMeetingStatus(notLive.id, "capturing");

    const listed = await store.listLiveMeetings();
    expect(listed.map((m) => m.id)).toEqual([live.id]);
  });
});

describe("POST /api/webhooks/recall — live transcript ingest", () => {
  it("appends an utterance + sets live_started_at for a live meeting", async () => {
    const m = await seedLiveMeeting();
    const { POST } = await import("@/app/api/webhooks/recall/route");

    const res = await POST(
      webhookReq(
        transcriptDataBody({
          meetingId: m.id,
          words: ["Good", "evening", "everyone"],
          participantName: "Council President",
          firstRelative: 12.25,
        })
      )
    );
    expect(res.status).toBe(200);

    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const lines = await store.listLiveUtterances(m.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Good evening everyone");
    expect(lines[0].speaker_label).toBe("Council President");
    expect(lines[0].ts_seconds).toBe(12.25);

    const updated = await store.getMeeting(m.id);
    expect(updated?.live_started_at).not.toBeNull();
  });

  it("falls back to a Speaker N label when participant.name is null", async () => {
    const m = await seedLiveMeeting();
    const { POST } = await import("@/app/api/webhooks/recall/route");
    await POST(
      webhookReq(
        transcriptDataBody({
          meetingId: m.id,
          words: ["Hello"],
          participantId: 7,
          participantName: null,
        })
      )
    );
    const { getStore } = await import("@/lib/store");
    const lines = await getStore().listLiveUtterances(m.id);
    expect(lines[0].speaker_label).toBe("Speaker 7");
  });

  it("appends nothing for a meeting that is not live_enabled", async () => {
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const m = await store.createMeeting({
      title: "Not live",
      body_name: "City Council",
      source_type: "zoom",
      source_url: "https://us02web.zoom.us/j/notlive",
      // live_enabled defaults false
    });
    await store.setMeetingStatus(m.id, "capturing");

    const { POST } = await import("@/app/api/webhooks/recall/route");
    const res = await POST(
      webhookReq(
        transcriptDataBody({ meetingId: m.id, words: ["Should", "not", "save"] })
      )
    );
    expect(res.status).toBe(200);

    const lines = await store.listLiveUtterances(m.id);
    expect(lines).toHaveLength(0);
    const after = await store.getMeeting(m.id);
    expect(after?.live_started_at).toBeNull();
  });
});

describe("GET /api/meetings/[id]/live", () => {
  it("returns since-filtered utterances and the live flag", async () => {
    const m = await seedLiveMeeting();
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const a = await store.appendLiveUtterance(m.id, { text: "first" });
    const b = await store.appendLiveUtterance(m.id, { text: "second" });

    const { GET } = await import("@/app/api/meetings/[id]/live/route");

    // No cursor: all lines, live === true.
    const all = await GET(
      new Request(`https://example.test/api/meetings/${m.id}/live`),
      { params: Promise.resolve({ id: m.id }) }
    );
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as {
      utterances: Array<{ id: number }>;
      live: boolean;
      cursor: number;
    };
    expect(allBody.utterances.map((u) => u.id)).toEqual([a.id, b.id]);
    expect(allBody.live).toBe(true);
    expect(allBody.cursor).toBe(b.id);

    // since=a.id: only the second line.
    const since = await GET(
      new Request(
        `https://example.test/api/meetings/${m.id}/live?since=${a.id}`
      ),
      { params: Promise.resolve({ id: m.id }) }
    );
    const sinceBody = (await since.json()) as {
      utterances: Array<{ id: number }>;
    };
    expect(sinceBody.utterances.map((u) => u.id)).toEqual([b.id]);
  });

  it("404s for an unknown meeting", async () => {
    const { GET } = await import("@/app/api/meetings/[id]/live/route");
    const res = await GET(
      new Request("https://example.test/api/meetings/nope/live"),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/meetings/[id]/live — phase lifecycle (regression)", () => {
  // Regression: before the bot joins, a live meeting sits in status "pending".
  // The poll must report "waiting" (NOT "ended"), or the client stops polling on
  // the first tick and never shows captions even once the meeting goes live.
  async function phaseFor(
    status: "pending" | "capturing" | "transcribing"
  ): Promise<{ phase: string; live: boolean }> {
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const m = await store.createMeeting({
      title: `Phase ${status}`,
      body_name: "City Council",
      source_type: "zoom",
      source_url: `https://us02web.zoom.us/j/phase-${status}`,
      live_enabled: true,
    });
    if (status !== "pending") await store.setMeetingStatus(m.id, status);
    const { GET } = await import("@/app/api/meetings/[id]/live/route");
    const res = await GET(
      new Request(`https://example.test/api/meetings/${m.id}/live`),
      { params: Promise.resolve({ id: m.id }) }
    );
    return (await res.json()) as { phase: string; live: boolean };
  }

  it("reports 'waiting' (not ended) before the bot joins so the client keeps polling", async () => {
    const body = await phaseFor("pending");
    expect(body.phase).toBe("waiting");
    expect(body.live).toBe(false);
  });

  it("reports 'live' while capturing", async () => {
    const body = await phaseFor("capturing");
    expect(body.phase).toBe("live");
    expect(body.live).toBe(true);
  });

  it("reports 'ended' once capture is over", async () => {
    const body = await phaseFor("transcribing");
    expect(body.phase).toBe("ended");
    expect(body.live).toBe(false);
  });
});

describe("createMeeting live_enabled persistence", () => {
  it("persists live_enabled true when requested", async () => {
    const { getStore } = await import("@/lib/store");
    const m = await getStore().createMeeting({
      title: "Live",
      body_name: "City Council",
      source_type: "zoom",
      source_url: "https://us02web.zoom.us/j/live",
      live_enabled: true,
    });
    expect(m.live_enabled).toBe(true);
    expect(m.live_started_at).toBeNull();
    expect(m.live_ended_at).toBeNull();
  });

  it("defaults live_enabled to false when omitted", async () => {
    const { getStore } = await import("@/lib/store");
    const m = await getStore().createMeeting({
      title: "Default",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://example.test/default",
    });
    expect(m.live_enabled).toBe(false);
  });
});
