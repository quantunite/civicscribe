// GET /api/health — a cheap liveness/readiness probe for the Railway
// healthcheck. Probes the store with a cheap read and reports
// { ok, store, mock }: 200 when the store read succeeds, 503 when it throws.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
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
    vi.restoreAllMocks();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("returns 200 { ok:true, store:'ok', mock:true } when the store read succeeds", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, store: "ok", mock: true });
  });

  it("returns 503 { ok:false, store:'error' } when the store probe throws", async () => {
    const store = await import("@/lib/store");
    vi.spyOn(store, "getStore").mockReturnValue({
      // The probe read rejects, simulating a store/DB outage.
      listSchedules: vi.fn().mockRejectedValue(new Error("db down")),
    } as never);

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, store: "error" });
  });
});
