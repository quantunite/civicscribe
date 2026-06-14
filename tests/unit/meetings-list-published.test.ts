// GET /api/meetings is public, so its default (admin-oriented) response returns
// every meeting. To keep the public dashboard + its poll loop published-safe,
// it also accepts ?published=true, which returns the library feed (published
// only). The non-admin MeetingList polls with that filter so unpublished items
// never leak to the public via the poll.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DATA_DIRS: string[] = [];

describe("GET /api/meetings — ?published=true filters to the library feed", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    DATA_DIRS.push(dataDir);
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    const g = globalThis as unknown as {
      __civicscribeStore?: unknown;
      __civicscribeFiles?: unknown;
    };
    delete g.__civicscribeStore;
    delete g.__civicscribeFiles;
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("returns only published meetings when published=true, all otherwise", async () => {
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const pub = await store.createMeeting({
      title: "Published",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    await store.createMeeting({
      title: "Pending",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://www.youtube.com/watch?v=aQw4w9WgXcA",
    });
    await store.publishMeeting(pub.id);

    const { GET } = await import("@/app/api/meetings/route");

    const adminRes = await GET(
      new Request("https://example.test/api/meetings?kind=civic")
    );
    const adminBody = await adminRes.json();
    expect(adminBody.map((m: { title: string }) => m.title).sort()).toEqual([
      "Pending",
      "Published",
    ]);

    const publicRes = await GET(
      new Request("https://example.test/api/meetings?kind=civic&published=true")
    );
    const publicBody = await publicRes.json();
    expect(publicBody.map((m: { title: string }) => m.title)).toEqual([
      "Published",
    ]);
  });
});
