// Self-serve result + "add to the public record" (design: docs/self-serve-transcript.md).
//
// Exercises the security-sensitive pieces end to end at the unit/route level:
//  * the single-meeting VIEW token (sign/verify, single-id scope, expiry);
//  * the detail API's extended published gate (token opens its one id only);
//  * the export route NOT honoring a view token (no download of unpublished);
//  * POST /api/meetings attestation requirement, the 201 viewToken mint, and the
//    dedup path returning no id/token to a non-staff caller;
//  * POST .../request-publish (sets publish_requested_at, idempotent; rejects an
//    unauthorized caller).
//
// SESSION_SECRET is set in the route describes so the token path is genuinely
// exercised (in open mode the published gate is already open and the token is
// moot). Uses the MemoryStore + temp-dataDir pattern with the store singleton
// cleared so route handlers and seeding share one store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  signMeetingView,
  verifyMeetingView,
  MEETING_VIEW_TTL_SECONDS,
} from "@/lib/auth/meeting-view";

const SESSION = "view-secret";
const OWNER = "owner-secret";

// ---------------------------------------------------------------------------
// 1) the token itself

describe("meeting-view token sign/verify", () => {
  const now = 1_700_000_000;
  const exp = now + MEETING_VIEW_TTL_SECONDS;

  it("verifies true for its own meeting id", async () => {
    const token = await signMeetingView({ mid: "m-A", exp }, SESSION);
    expect(await verifyMeetingView(token, SESSION, "m-A", now)).toBe(true);
  });

  it("verifies false for a DIFFERENT meeting id (single-id scope)", async () => {
    const token = await signMeetingView({ mid: "m-A", exp }, SESSION);
    expect(await verifyMeetingView(token, SESSION, "m-B", now)).toBe(false);
  });

  it("verifies false when expired", async () => {
    const token = await signMeetingView({ mid: "m-A", exp: now - 1 }, SESSION);
    expect(await verifyMeetingView(token, SESSION, "m-A", now)).toBe(false);
    // Equivalently: a far-future "now" makes a normally-valid token expired.
    const fresh = await signMeetingView({ mid: "m-A", exp }, SESSION);
    expect(
      await verifyMeetingView(fresh, SESSION, "m-A", exp + 1)
    ).toBe(false);
  });

  it("verifies false for a wrong secret and for garbage, without throwing", async () => {
    const token = await signMeetingView({ mid: "m-A", exp }, SESSION);
    expect(await verifyMeetingView(token, "other", "m-A", now)).toBe(false);
    expect(await verifyMeetingView(null, SESSION, "m-A", now)).toBe(false);
    expect(await verifyMeetingView("", SESSION, "m-A", now)).toBe(false);
    expect(await verifyMeetingView("nodot", SESSION, "m-A", now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// helpers for the route-level describes

function clearStoreSingleton() {
  const g = globalThis as unknown as {
    __civicscribeStore?: unknown;
    __civicscribeFiles?: unknown;
  };
  delete g.__civicscribeStore;
  delete g.__civicscribeFiles;
}

// ---------------------------------------------------------------------------
// 2) detail API gate + 3) export gate

describe("GET /api/meetings/[id] — view token gate (SESSION_SECRET set)", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    // Both secrets set => not open mode; the token path is exercised.
    process.env.OWNER_SECRET = OWNER;
    process.env.SESSION_SECRET = SESSION;
    clearStoreSingleton();
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    clearStoreSingleton();
    vi.resetModules();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  async function seedUnpublished(url: string): Promise<string> {
    const { getStore } = await import("@/lib/store");
    const m = await getStore().createMeeting({
      title: "Pending review",
      body_name: "City Council",
      source_type: "stream",
      source_url: url,
      attestation: "public",
    });
    return m.id;
  }

  function getReq(id: string, viewToken?: string): Request {
    const headers = new Headers();
    if (viewToken) headers.set("x-cs-view", viewToken);
    return new Request(`https://example.test/api/meetings/${id}`, { headers });
  }

  it("404s an unpublished meeting with no token", async () => {
    const id = await seedUnpublished("https://youtu.be/aaaaaaaaaaa");
    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
  });

  it("200s with a valid view token for that id (and is not cached)", async () => {
    const id = await seedUnpublished("https://youtu.be/bbbbbbbbbbb");
    const token = await signMeetingView(
      { mid: id, exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS },
      SESSION
    );
    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id, token), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const detail = await res.json();
    expect(detail.meeting.id).toBe(id);
    expect(detail.meeting.published).toBe(false);
  });

  it("404s when the token is for a DIFFERENT meeting id", async () => {
    const idA = await seedUnpublished("https://youtu.be/ccccccccccc");
    const idB = await seedUnpublished("https://youtu.be/ddddddddddd");
    const tokenForB = await signMeetingView(
      {
        mid: idB,
        exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS,
      },
      SESSION
    );
    const { GET } = await import("@/app/api/meetings/[id]/route");
    // Present B's token while reading A -> rejected.
    const res = await GET(getReq(idA, tokenForB), {
      params: Promise.resolve({ id: idA }),
    });
    expect(res.status).toBe(404);
  });

  it("200s a published meeting regardless of token", async () => {
    const id = await seedUnpublished("https://youtu.be/eeeeeeeeeee");
    const { getStore } = await import("@/lib/store");
    await getStore().publishMeeting(id);
    const { GET } = await import("@/app/api/meetings/[id]/route");
    const res = await GET(getReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
  });

  it("export route STILL 404s an unpublished meeting with a valid view token", async () => {
    const id = await seedUnpublished("https://youtu.be/fffffffffff");
    const token = await signMeetingView(
      { mid: id, exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS },
      SESSION
    );
    const { GET } = await import("@/app/api/meetings/[id]/export/route");
    const res = await GET(
      new Request(
        `https://example.test/api/meetings/${id}/export?format=txt`,
        { headers: { "x-cs-view": token } }
      ),
      { params: Promise.resolve({ id }) }
    );
    // The token does NOT enable download: export stays published-or-staff only.
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 4) submit: attestation + 201 viewToken + dedup no-id/no-token

describe("POST /api/meetings — attestation + view token + dedup", () => {
  let dataDir: string;

  function jsonReq(body: unknown): Request {
    return new Request("https://example.test/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    // Both secrets set so a credential-less caller is genuinely NON-staff (with
    // OWNER_SECRET unset the access layer treats everyone as staff). This is what
    // exercises the dedup id-less path; SESSION_SECRET also exercises the mint.
    process.env.OWNER_SECRET = OWNER;
    process.env.SESSION_SECRET = SESSION;
    clearStoreSingleton();
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    clearStoreSingleton();
    vi.resetModules();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  it("400s a submission missing attestation", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/ggggggggggg",
        terms_agreed: true,
      })
    );
    expect(res.status).toBe(400);
  });

  it("400s a submission missing the clickwrap agreement (terms_agreed)", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    // attestation present but the required binding clickwrap is absent.
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/nagreed0001",
        attestation: "public",
      })
    );
    expect(res.status).toBe(400);
    // And nothing was created without the agreement.
    const { getStore } = await import("@/lib/store");
    expect(await getStore().listMeetings()).toHaveLength(0);
  });

  it("400s a submission with terms_agreed=false (must be exactly true)", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/nagreed0002",
        attestation: "public",
        terms_agreed: false,
      })
    );
    expect(res.status).toBe(400);
  });

  it("201s a NEW submission with a viewToken and persists the attestation", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/hhhhhhhhhhh",
        attestation: "authorized",
        terms_agreed: true,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toEqual(expect.any(String));
    expect(body.attestation).toBe("authorized");
    // The binding clickwrap agreement is persisted with the submission: agreed,
    // a server timestamp, and the terms version in force.
    const { TERMS_VERSION } = await import("@/lib/legal");
    expect(body.terms_agreed).toBe(true);
    expect(body.terms_agreed_at).toEqual(expect.any(String));
    expect(body.terms_version).toBe(TERMS_VERSION);
    // And it round-trips from the store, not just the response body.
    const { getStore } = await import("@/lib/store");
    const persisted = await getStore().getMeeting(body.id);
    expect(persisted?.terms_agreed).toBe(true);
    expect(persisted?.terms_agreed_at).toEqual(expect.any(String));
    expect(persisted?.terms_version).toBe(TERMS_VERSION);
    expect(typeof body.viewToken).toBe("string");
    // The minted token must verify for exactly this meeting id.
    expect(await verifyMeetingView(body.viewToken, SESSION, body.id)).toBe(
      true
    );
  });

  it("dedup hit -> 200 { duplicate: true } with NO id and NO viewToken (non-staff)", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const first = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://www.youtube.com/watch?v=dedupVid001",
        attestation: "public",
        terms_agreed: true,
      })
    );
    expect(first.status).toBe(201);

    const second = await POST(
      jsonReq({
        title: "Council resubmit",
        body_name: "City Council",
        source_type: "stream",
        source_url: "https://youtu.be/dedupVid001?si=tracking",
        attestation: "public",
        terms_agreed: true,
      })
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.duplicate).toBe(true);
    expect(body.id).toBeUndefined();
    expect(body.meeting).toBeUndefined();
    expect(body.viewToken).toBeUndefined();

    // And no second meeting was created.
    const { getStore } = await import("@/lib/store");
    expect(await getStore().listMeetings()).toHaveLength(1);
  });

  it("400s a bot source (zoom) with the non-public 'authorized' basis", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "zoom",
        source_url: "https://us02web.zoom.us/j/12345",
        attestation: "authorized",
        terms_agreed: true,
      })
    );
    // A recording bot may only join an open public meeting.
    expect(res.status).toBe(400);
  });

  it("201s a bot source (zoom) with the 'public' basis", async () => {
    const { POST } = await import("@/app/api/meetings/route");
    const res = await POST(
      jsonReq({
        title: "Council",
        body_name: "City Council",
        source_type: "zoom",
        source_url: "https://us02web.zoom.us/j/67890",
        attestation: "public",
        terms_agreed: true,
      })
    );
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 5) request-publish

describe("POST /api/meetings/[id]/request-publish", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const { makeTempDataDir } = await import("./helpers");
    dataDir = await makeTempDataDir();
    process.env.MOCK_MODE = "true";
    process.env.DATA_DIR = dataDir;
    process.env.OWNER_SECRET = OWNER;
    process.env.SESSION_SECRET = SESSION;
    clearStoreSingleton();
  });

  afterEach(async () => {
    delete process.env.MOCK_MODE;
    delete process.env.DATA_DIR;
    delete process.env.OWNER_SECRET;
    delete process.env.SESSION_SECRET;
    clearStoreSingleton();
    vi.resetModules();
    const { cleanupDataDir } = await import("./helpers");
    await cleanupDataDir(dataDir);
  });

  async function seed(): Promise<string> {
    const { getStore } = await import("@/lib/store");
    const m = await getStore().createMeeting({
      title: "Pending",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://youtu.be/reqpublish1",
      attestation: "public",
    });
    return m.id;
  }

  function postReq(id: string, viewToken?: string): Request {
    const headers = new Headers();
    if (viewToken) headers.set("x-cs-view", viewToken);
    return new Request(
      `https://example.test/api/meetings/${id}/request-publish`,
      { method: "POST", headers }
    );
  }

  it("sets publish_requested_at with a valid view token, idempotently", async () => {
    const id = await seed();
    const token = await signMeetingView(
      { mid: id, exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS },
      SESSION
    );
    const { POST } = await import(
      "@/app/api/meetings/[id]/request-publish/route"
    );
    const { getStore } = await import("@/lib/store");

    const res1 = await POST(postReq(id, token), {
      params: Promise.resolve({ id }),
    });
    expect(res1.status).toBe(200);
    const after1 = await getStore().getMeeting(id);
    expect(after1?.publish_requested_at).toEqual(expect.any(String));

    // Idempotent: a second call keeps the original timestamp.
    const res2 = await POST(postReq(id, token), {
      params: Promise.resolve({ id }),
    });
    expect(res2.status).toBe(200);
    const after2 = await getStore().getMeeting(id);
    expect(after2?.publish_requested_at).toBe(after1?.publish_requested_at);
  });

  it("403s a caller with no token and no staff credential", async () => {
    const id = await seed();
    const { POST } = await import(
      "@/app/api/meetings/[id]/request-publish/route"
    );
    const res = await POST(postReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(403);
    const { getStore } = await import("@/lib/store");
    expect((await getStore().getMeeting(id))?.publish_requested_at).toBeNull();
  });

  it("403s a token minted for a DIFFERENT meeting", async () => {
    const id = await seed();
    const otherToken = await signMeetingView(
      {
        mid: "some-other-id",
        exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS,
      },
      SESSION
    );
    const { POST } = await import(
      "@/app/api/meetings/[id]/request-publish/route"
    );
    const res = await POST(postReq(id, otherToken), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("404s a missing meeting", async () => {
    const { POST } = await import(
      "@/app/api/meetings/[id]/request-publish/route"
    );
    const res = await POST(postReq("no-such-id"), {
      params: Promise.resolve({ id: "no-such-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("allows staff (Bearer OWNER_SECRET) to request publish", async () => {
    const id = await seed();
    const { POST } = await import(
      "@/app/api/meetings/[id]/request-publish/route"
    );
    const headers = new Headers();
    headers.set("authorization", `Bearer ${OWNER}`);
    const req = new Request(
      `https://example.test/api/meetings/${id}/request-publish`,
      { method: "POST", headers }
    );
    const res = await POST(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const { getStore } = await import("@/lib/store");
    expect((await getStore().getMeeting(id))?.publish_requested_at).toEqual(
      expect.any(String)
    );
  });
});
