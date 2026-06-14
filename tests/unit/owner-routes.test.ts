// Integration-style checks of the access boundary at the route-handler level.
//
// Next.js edge middleware does not run under vitest, so we exercise the same
// contract two ways:
//   1) the centralized route guard requireAdmin() returns a 401 unauthenticated
//      and passes (null) with the credential, but only when OWNER_SECRET is set;
//   2) a real gated route (DELETE /api/meetings/[id]) 401s unauthenticated and
//      performs the delete (200/204) with the credential.
// Plus the owner-login + logout cookie routes: set on match, 401 on miss,
// complete no-op when OWNER_SECRET is unset, and clear on logout.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER_COOKIE, requireAdmin } from "@/lib/owner";

const DATA_DIRS: string[] = [];

afterEach(() => {
  delete process.env.OWNER_SECRET;
  vi.resetModules();
});

function req(headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request("https://example.test/api/x", { headers, method });
}

describe("requireAdmin — centralized route guard", () => {
  it("is a no-op (returns null) when OWNER_SECRET is unset", () => {
    delete process.env.OWNER_SECRET;
    expect(requireAdmin(req())).toBeNull();
  });

  it("returns a 401 JSON response when the secret is set and creds are missing", async () => {
    process.env.OWNER_SECRET = "s3cret";
    const res = requireAdmin(req());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns null (allowed) with the correct cs-owner cookie", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(requireAdmin(req({ cookie: `${OWNER_COOKIE}=s3cret` }))).toBeNull();
  });

  it("returns null (allowed) with the correct Bearer token", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(requireAdmin(req({ authorization: "Bearer s3cret" }))).toBeNull();
  });
});

// A gated route exercised end to end through its handler. We point the store at
// a temp dir and seed one meeting, then call DELETE with/without the credential.
describe("DELETE /api/meetings/[id] — gated route", () => {
  let dataDir: string;
  let meetingId: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    DATA_DIRS.push(dataDir);
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    // The store factory caches a singleton on globalThis (it survives
    // resetModules). Clear it so getStore() rebinds to THIS test's dataDir and
    // the route handler and our seeding share one store.
    const g = globalThis as unknown as {
      __civicscribeStore?: unknown;
      __civicscribeFiles?: unknown;
    };
    delete g.__civicscribeStore;
    delete g.__civicscribeFiles;
    const { getStore } = await import("@/lib/store");
    const m = await getStore().createMeeting({
      title: "Gated",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    meetingId = m.id;
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("401s an unauthenticated DELETE when OWNER_SECRET is set", async () => {
    process.env.OWNER_SECRET = "s3cret";
    const { DELETE } = await import("@/app/api/meetings/[id]/route");
    const res = await DELETE(req({}, "DELETE"), {
      params: Promise.resolve({ id: meetingId }),
    });
    expect(res.status).toBe(401);
  });

  it("deletes with the correct Bearer credential when OWNER_SECRET is set", async () => {
    process.env.OWNER_SECRET = "s3cret";
    const { DELETE } = await import("@/app/api/meetings/[id]/route");
    const res = await DELETE(
      req({ authorization: "Bearer s3cret" }, "DELETE"),
      { params: Promise.resolve({ id: meetingId }) }
    );
    expect(res.status).toBe(204);

    const { MemoryStore } = await import("@/lib/store/memory");
    const store = new MemoryStore(dataDir);
    expect(await store.getMeeting(meetingId)).toBeNull();
  });

  it("deletes WITHOUT any credential when OWNER_SECRET is unset (no-op mode)", async () => {
    delete process.env.OWNER_SECRET;
    const { DELETE } = await import("@/app/api/meetings/[id]/route");
    const res = await DELETE(req({}, "DELETE"), {
      params: Promise.resolve({ id: meetingId }),
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/owner-login", () => {
  function loginReq(secret: string): Request {
    return new Request("https://example.test/api/owner-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
  }

  it("sets the cs-owner cookie on a correct secret", async () => {
    process.env.OWNER_SECRET = "s3cret";
    const { POST } = await import("@/app/api/owner-login/route");
    const res = await POST(loginReq("s3cret"));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${OWNER_COOKIE}=s3cret`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("401s on a wrong secret without setting a cookie", async () => {
    process.env.OWNER_SECRET = "s3cret";
    const { POST } = await import("@/app/api/owner-login/route");
    const res = await POST(loginReq("wrongXX"));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("is a no-op (no cookie set, ok) when OWNER_SECRET is unset", async () => {
    delete process.env.OWNER_SECRET;
    const { POST } = await import("@/app/api/owner-login/route");
    const res = await POST(loginReq("anything"));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/owner-logout", () => {
  it("clears the cs-owner cookie", async () => {
    const { POST } = await import("@/app/api/owner-logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${OWNER_COOKIE}=`);
    // Cleared via Max-Age=0 (or an expiry in the past).
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });
});
