// POST /api/schedules: the one-off vs recurring split.
//
// COST SAFETY is the #1 invariant: a one-off is PUBLIC but rate-limited
// (enforceSubmitGuardrails runs first); a recurring schedule is ADMIN ONLY
// (requireAdmin runs first, a non-admin gets 401). A one-off requires a future
// datetime and rejects a past one. GET stays public.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimitsForTests } from "@/lib/ratelimit";

let dataDir: string;

function jsonReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/schedules", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** A future instant well clear of "now" so the future-datetime check passes. */
function future(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function oneOffBody(suffix: string, when: string) {
  return {
    mode: "one-off" as const,
    title: `Record once ${suffix}`,
    body_name: "City Council",
    source_type: "stream" as const,
    source_url: `https://www.youtube.com/watch?v=oneoff${suffix}`,
    next_fire_at: when,
  };
}

function recurringBody() {
  return {
    mode: "recurring" as const,
    title: "Weekly Council",
    body_name: "City Council",
    source_type: "stream" as const,
    source_url: "https://www.youtube.com/@city/live",
    recurrence: {
      freq: "weekly" as const,
      weekday: 2,
      time: "18:00",
      timezone: "America/Chicago",
    },
  };
}

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
  vi.resetModules();
  const { cleanupDataDir } = await import("./helpers");
  await cleanupDataDir(dataDir);
});

describe("POST /api/schedules: one-off (public, rate-limited)", () => {
  it("creates a one-off for a non-admin and persists one_off + null recurrence", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const when = future();
    const res = await POST(
      jsonReq(oneOffBody("a", when), { "x-forwarded-for": "203.0.113.7" })
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      one_off: boolean;
      recurrence: unknown;
      next_fire_at: string;
    };
    expect(created.one_off).toBe(true);
    expect(created.recurrence).toBeNull();
    expect(created.next_fire_at).toBe(when);
  });

  it("rate-limits one-off creation for a non-admin (enforceSubmitGuardrails)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const ip = { "x-forwarded-for": "203.0.113.8" };
    expect((await POST(jsonReq(oneOffBody("a", future()), ip))).status).toBe(201);
    expect((await POST(jsonReq(oneOffBody("b", future()), ip))).status).toBe(201);
    const blocked = await POST(jsonReq(oneOffBody("c", future()), ip));
    expect(blocked.status).toBe(429);
  });

  it("rejects a one-off with a past datetime (400)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await POST(
      jsonReq(oneOffBody("p", past), { "x-forwarded-for": "203.0.113.9" })
    );
    expect(res.status).toBe(400);
  });

  it("accepts a one-off with a future datetime (201)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const res = await POST(
      jsonReq(oneOffBody("f", future()), { "x-forwarded-for": "203.0.113.10" })
    );
    expect(res.status).toBe(201);
  });

  it("rejects a one-off that also carries a recurrence (400)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const body = {
      ...oneOffBody("r", future()),
      recurrence: {
        freq: "weekly",
        weekday: 2,
        time: "18:00",
        timezone: "America/Chicago",
      },
    };
    const res = await POST(
      jsonReq(body, { "x-forwarded-for": "203.0.113.11" })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/schedules: recurring (admin only)", () => {
  it("rejects a non-admin recurring POST with 401", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const res = await POST(
      jsonReq(recurringBody(), { "x-forwarded-for": "203.0.113.12" })
    );
    expect(res.status).toBe(401);
  });

  it("creates a recurring schedule for an admin (Bearer secret)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const res = await POST(
      jsonReq(recurringBody(), { authorization: "Bearer s3cret" })
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      one_off: boolean;
      recurrence: { freq: string } | null;
      next_fire_at: string;
    };
    expect(created.one_off).toBe(false);
    expect(created.recurrence?.freq).toBe("weekly");
    expect(new Date(created.next_fire_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("treats a missing mode with recurrence present as recurring (backward compatible)", async () => {
    const { POST } = await import("@/app/api/schedules/route");
    const { mode: _mode, ...noMode } = recurringBody();
    void _mode;
    // Non-admin: still admin-gated, so 401 (proves it routed to the recurring path).
    const denied = await POST(
      jsonReq(noMode, { "x-forwarded-for": "203.0.113.13" })
    );
    expect(denied.status).toBe(401);
    // Admin: creates it.
    const ok = await POST(jsonReq(noMode, { authorization: "Bearer s3cret" }));
    expect(ok.status).toBe(201);
  });
});
