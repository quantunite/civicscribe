// Published boundary on the per-item read: GET /api/meetings/[id] must not
// expose an unpublished (pending-review) meeting to a non-admin by direct UUID.
// A non-admin gets 404 (existence not even confirmed); an admin (OWNER_SECRET
// via Bearer) gets the full MeetingDetail. The export route shares the boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DATA_DIRS: string[] = [];
const SECRET = "s3cret";

describe("GET /api/meetings/[id] — published boundary", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    DATA_DIRS.push(dataDir);
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    process.env.OWNER_SECRET = SECRET;
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
    delete process.env.OWNER_SECRET;
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  async function seedUnpublished(): Promise<string> {
    const { getStore } = await import("@/lib/store");
    const meeting = await getStore().createMeeting({
      title: "Pending review",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    return meeting.id;
  }

  function getReq(id: string, init: { bearer?: string } = {}): Request {
    const headers = new Headers();
    if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
    return new Request(`https://example.test/api/meetings/${id}`, { headers });
  }

  it("404s an unpublished meeting for a non-admin", async () => {
    const id = await seedUnpublished();
    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
  });

  it("returns full detail for an admin (Bearer OWNER_SECRET)", async () => {
    const id = await seedUnpublished();
    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id, { bearer: SECRET }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.meeting.id).toBe(id);
    expect(detail.meeting.published).toBe(false);
  });

  it("returns the meeting once published, even to a non-admin", async () => {
    const id = await seedUnpublished();
    const { getStore } = await import("@/lib/store");
    await getStore().publishMeeting(id);

    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.meeting.id).toBe(id);
  });

  it("export route 404s an unpublished meeting for a non-admin", async () => {
    const id = await seedUnpublished();
    const { GET } = await import("@/app/api/meetings/[id]/export/route");
    const res = await GET(
      new Request(`https://example.test/api/meetings/${id}/export?format=txt`),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(404);
  });
});
