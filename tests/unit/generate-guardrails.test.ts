// Guardrail enforcement at the public generate route level (POST /api/meetings,
// POST /api/upload). With OWNER_SECRET set, a public caller is rate-limited and
// gets a 429 once past the per-IP cap; the admin (Bearer secret) is exempt.
// With OWNER_SECRET unset (the default test/dev mode) everyone is admin, so the
// guardrails are a complete no-op — covered implicitly by the rest of the suite.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimitsForTests } from "@/lib/ratelimit";

function jsonReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/meetings", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function meetingBody(suffix: string) {
  return {
    title: `Council ${suffix}`,
    body_name: "City Council",
    source_type: "stream" as const,
    // Unique video id per call so dedup never short-circuits the submission.
    source_url: `https://www.youtube.com/watch?v=vid${suffix}`,
  };
}

describe("POST /api/meetings — guardrails", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    __resetRateLimitsForTests();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "2";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1000";
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
    delete process.env.MAX_SUBMITS_PER_IP_PER_DAY;
    delete process.env.MAX_SUBMITS_GLOBAL_PER_DAY;
    __resetRateLimitsForTests();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("429s a public caller once past the per-IP daily limit", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const ipHeader = { "x-forwarded-for": "203.0.113.5" };

    expect((await POST(jsonReq(meetingBody("a"), ipHeader))).status).toBe(201);
    expect((await POST(jsonReq(meetingBody("b"), ipHeader))).status).toBe(201);

    const blocked = await POST(jsonReq(meetingBody("c"), ipHeader));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("exempts the admin from the per-IP limit (Bearer secret)", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const headers = {
      "x-forwarded-for": "203.0.113.5",
      authorization: "Bearer s3cret",
    };
    // Well past the cap of 2 — all succeed because admin is exempt.
    for (const s of ["a", "b", "c", "d"]) {
      expect((await POST(jsonReq(meetingBody(s), headers))).status).toBe(201);
    }
  });
});

describe("POST /api/upload — guardrails", () => {
  let dataDir: string;

  function uploadReq(headers: Record<string, string> = {}): Request {
    const form = new FormData();
    form.set("title", "Uploaded session");
    form.set("body_name", "City Council");
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "clip.mp3", {
        type: "audio/mpeg",
      })
    );
    return new Request("https://example.test/api/upload", {
      method: "POST",
      headers,
      body: form,
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    __resetRateLimitsForTests();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1000";
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
    delete process.env.MAX_SUBMITS_PER_IP_PER_DAY;
    delete process.env.MAX_SUBMITS_GLOBAL_PER_DAY;
    __resetRateLimitsForTests();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("429s a public uploader once past the per-IP daily limit", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const ipHeader = { "x-forwarded-for": "198.51.100.9" };

    expect((await POST(uploadReq(ipHeader))).status).toBe(201);
    const blocked = await POST(uploadReq(ipHeader));
    expect(blocked.status).toBe(429);
  });

  it("exempts the admin uploader (Bearer secret)", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const headers = {
      "x-forwarded-for": "198.51.100.9",
      authorization: "Bearer s3cret",
    };
    expect((await POST(uploadReq(headers))).status).toBe(201);
    expect((await POST(uploadReq(headers))).status).toBe(201);
  });
});
