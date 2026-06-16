// Public generate + dedup contract at the route-handler level.
//
// POST /api/meetings stays PUBLIC (no admin gate) but is dedup-guarded: on
// submit it computes the normalized source_key and looks it up. If an existing
// meeting matches, it does NOT re-create or re-process (that would spend real
// money again) and returns 200 with { duplicate: true, meeting: <existing> } so
// the UI can show the existing one. New (non-duplicate) meetings are created
// with published=false (pending admin review) and return 201.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DATA_DIRS: string[] = [];

function jsonReq(body: unknown): Request {
  return new Request("https://example.test/api/meetings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/meetings — public generate + dedup", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    DATA_DIRS.push(dataDir);
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    // Drop the cached store singleton so getStore() rebinds to this temp dir.
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

  it("creates a new meeting published=false and returns 201 (not a duplicate)", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council June 9",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        attestation: "public",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.duplicate).toBeUndefined();
    expect(body.published).toBe(false);
    expect(body.id).toEqual(expect.any(String));
  });

  it("returns 200 { duplicate: true, meeting } for a same-source resubmit", async () => {
    const { POST } = await import("@/app/api/meetings/route");

    const first = await POST(
      jsonReq({
        title: "Council June 9",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        attestation: "public",
      })
    );
    const firstBody = await first.json();

    // A DIFFERENT youtube URL shape for the same video must dedup to the first.
    const second = await POST(
      jsonReq({
        title: "Council June 9 (resubmit)",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/dQw4w9WgXcQ?si=tracking",
        attestation: "public",
      })
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.duplicate).toBe(true);
    // No secrets set in this suite => open mode => the caller is treated as
    // staff, so the dedup path returns the existing meeting for convenience.
    expect(secondBody.meeting.id).toBe(firstBody.id);

    // And it must NOT have created a second meeting.
    const { getStore } = await import("@/lib/store");
    expect(await getStore().listMeetings()).toHaveLength(1);
  });
});

describe("POST /api/upload — public generate, pending review", () => {
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

  it("creates an upload meeting published=false (pending review), returns 201", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const form = new FormData();
    form.set("title", "Uploaded session");
    form.set("body_name", "City Council");
    form.set("attestation", "public");
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "clip.mp3", {
        type: "audio/mpeg",
      })
    );
    const req = new Request("https://example.test/api/upload", {
      method: "POST",
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.published).toBe(false);
    // Uploads carry no source_url, so they have no dedup key.
    expect(body.source_key).toBeNull();
  });
});
