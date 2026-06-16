// Regression: per-user cs-session accounts (admin/moderator) must be authorized
// for staff actions, not only the legacy OWNER_SECRET break-glass.
//
// This is the bug behind "I can't edit the schedule": sign-in issues a signed
// cs-session, but the schedule list/edit/save guards (and the rest of the admin
// surface) were still owner-cookie-only, so a signed-in admin was locked out.
// We assert the new request-context guard (isStaffRequest/requireStaff) admits a
// valid admin/moderator session, still honors the owner break-glass, rejects a
// plain user / expired / anonymous request, and that the schedule edit route is
// wired to it end to end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signSession, type Role } from "@/lib/auth/session";
import { __resetRateLimitsForTests } from "@/lib/ratelimit";

const OWNER = "s3cret";
const SESSION = "sess3cret";

/** A `cookie` header carrying a signed cs-session for the given role. */
async function sessionCookie(
  role: Role,
  opts: { expired?: boolean } = {}
): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const exp = opts.expired ? nowS - 60 : nowS + 3600;
  const token = await signSession({ uid: "u-1", role, exp }, SESSION);
  return `cs-session=${token}`;
}

function req(headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request("https://example.test/api/x", { headers, method });
}

describe("isStaffRequest / requireStaff — session-aware staff guard", () => {
  beforeEach(() => {
    process.env.OWNER_SECRET = OWNER;
    process.env.SESSION_SECRET = SESSION;
  });
  afterEach(() => {
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    vi.resetModules();
  });

  it("admits an admin cs-session", async () => {
    const { isStaffRequest } = await import("@/lib/owner");
    expect(
      await isStaffRequest(req({ cookie: await sessionCookie("admin") }))
    ).toBe(true);
  });

  it("admits a moderator cs-session", async () => {
    const { isStaffRequest } = await import("@/lib/owner");
    expect(
      await isStaffRequest(req({ cookie: await sessionCookie("moderator") }))
    ).toBe(true);
  });

  it("rejects a plain user cs-session (401)", async () => {
    const { isStaffRequest, requireStaff } = await import("@/lib/owner");
    const r = req({ cookie: await sessionCookie("user") });
    expect(await isStaffRequest(r)).toBe(false);
    expect((await requireStaff(r))?.status).toBe(401);
  });

  it("rejects an expired admin cs-session", async () => {
    const { isStaffRequest } = await import("@/lib/owner");
    expect(
      await isStaffRequest(
        req({ cookie: await sessionCookie("admin", { expired: true }) })
      )
    ).toBe(false);
  });

  it("rejects an anonymous request when secrets are set (401)", async () => {
    const { isStaffRequest, requireStaff } = await import("@/lib/owner");
    expect(await isStaffRequest(req())).toBe(false);
    expect((await requireStaff(req()))?.status).toBe(401);
  });

  it("still admits the legacy owner Bearer break-glass", async () => {
    const { isStaffRequest } = await import("@/lib/owner");
    expect(
      await isStaffRequest(req({ authorization: `Bearer ${OWNER}` }))
    ).toBe(true);
  });

  it("still admits the legacy cs-owner cookie", async () => {
    const { OWNER_COOKIE, isStaffRequest } = await import("@/lib/owner");
    expect(
      await isStaffRequest(req({ cookie: `${OWNER_COOKIE}=${OWNER}` }))
    ).toBe(true);
  });

  it("is open (no-op) for everyone when neither secret is set", async () => {
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    const { isStaffRequest, requireStaff } = await import("@/lib/owner");
    expect(await isStaffRequest(req())).toBe(true);
    expect(await requireStaff(req())).toBeNull();
  });
});

describe("PATCH /api/schedules/[id] — a signed-in admin can edit (regression)", () => {
  let dataDir: string;
  let scheduleId: string;

  beforeEach(async () => {
    vi.resetModules();
    __resetRateLimitsForTests();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    process.env.OWNER_SECRET = OWNER;
    process.env.SESSION_SECRET = SESSION;
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1000";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1000";
    const g = globalThis as unknown as {
      __civicscribeStore?: unknown;
      __civicscribeFiles?: unknown;
    };
    delete g.__civicscribeStore;
    delete g.__civicscribeFiles;

    // Seed a future one-off schedule through the real (public) creation path.
    const { POST } = await import("@/app/api/schedules/route");
    const when = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const createRes = await POST(
      new Request("https://example.test/api/schedules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.50",
        },
        body: JSON.stringify({
          mode: "one-off",
          title: "Original title",
          body_name: "City Council",
          source_type: "stream",
          source_url: "https://www.youtube.com/watch?v=seedstaff",
          next_fire_at: when,
        }),
      })
    );
    expect(createRes.status).toBe(201);
    scheduleId = ((await createRes.json()) as { id: string }).id;
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    delete process.env.MAX_SUBMITS_PER_IP_PER_DAY;
    delete process.env.MAX_SUBMITS_GLOBAL_PER_DAY;
    __resetRateLimitsForTests();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
    vi.resetModules();
  });

  function patch(headers: Record<string, string>, body: unknown): Request {
    return new Request(`https://example.test/api/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("401s an unauthenticated content edit", async () => {
    const { PATCH } = await import("@/app/api/schedules/[id]/route");
    const res = await PATCH(patch({}, { title: "Hacked" }), {
      params: Promise.resolve({ id: scheduleId }),
    });
    expect(res.status).toBe(401);
  });

  it("lets an admin cs-session edit the schedule (was previously owner-only)", async () => {
    const { PATCH } = await import("@/app/api/schedules/[id]/route");
    const res = await PATCH(
      patch({ cookie: await sessionCookie("admin") }, { title: "Updated title" }),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toBe("Updated title");
  });

  it("rejects a plain user cs-session (401)", async () => {
    const { PATCH } = await import("@/app/api/schedules/[id]/route");
    const res = await PATCH(
      patch({ cookie: await sessionCookie("user") }, { title: "Nope" }),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(res.status).toBe(401);
  });
});
