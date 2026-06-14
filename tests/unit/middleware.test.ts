// Edge middleware: the access boundary on the ADMIN surface.
//
// HARD INVARIANT: when OWNER_SECRET is unset the middleware is a COMPLETE
// pass-through (no-op) so dev + the whole suite are unaffected. When set, the
// admin surface needs the cs-owner cookie or an Authorization: Bearer header:
// /api/* gets a 401 JSON, pages get a redirect to /owner-login. Public reads,
// search, export, audio, and the public generate routes stay open. The
// already-secret-gated tick + Recall webhook are excluded.

import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const SECRET = "s3cret";

afterEach(() => {
  delete process.env.OWNER_SECRET;
});

function mk(
  pathname: string,
  init: { method?: string; cookie?: string; bearer?: string } = {}
): NextRequest {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  return new NextRequest(`https://example.test${pathname}`, {
    method: init.method ?? "GET",
    headers,
  });
}

/** A NextResponse.next() carries the internal x-middleware-next: 1 header;
 *  a 401/redirect does not. */
function isPassThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("middleware — no-op when OWNER_SECRET is unset", () => {
  it("passes through a gated DELETE when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    const res = middleware(mk("/api/meetings/abc", { method: "DELETE" }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through a gated page when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    const res = middleware(mk("/review"));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — gated /api/* returns 401 JSON when set", () => {
  it("401s an unauthenticated DELETE /api/meetings/[id]", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(mk("/api/meetings/abc", { method: "DELETE" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("401s an unauthenticated POST /api/meetings/[id]/speakers", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(
      mk("/api/meetings/abc/speakers", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  it("401s an unauthenticated PATCH /api/utterances/[id]", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(mk("/api/utterances/u1", { method: "PATCH" }));
    expect(res.status).toBe(401);
  });

  it("passes through POST /api/schedules (one-off public vs recurring admin decided in-handler)", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(mk("/api/schedules", { method: "POST" }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("401s an unauthenticated PATCH and DELETE /api/schedules/[id]", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(middleware(mk("/api/schedules/s1", { method: "PATCH" })).status).toBe(
      401
    );
    expect(
      middleware(mk("/api/schedules/s1", { method: "DELETE" })).status
    ).toBe(401);
  });

  it("401s the publish + unpublish endpoints", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      middleware(mk("/api/meetings/abc/publish", { method: "POST" })).status
    ).toBe(401);
    expect(
      middleware(mk("/api/meetings/abc/unpublish", { method: "POST" })).status
    ).toBe(401);
  });

  it("allows the gated /api call with the correct cookie", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(
      mk("/api/meetings/abc", { method: "DELETE", cookie: `cs-owner=${SECRET}` })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("allows the gated /api call with the correct Bearer", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(
      mk("/api/meetings/abc", { method: "DELETE", bearer: SECRET })
    );
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — gated pages redirect to /owner-login when set", () => {
  it("redirects /review (the moderation queue)", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(mk("/review"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/owner-login");
  });

  it("allows the gated page with the correct cookie", () => {
    process.env.OWNER_SECRET = SECRET;
    const res = middleware(mk("/review", { cookie: `cs-owner=${SECRET}` }));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — public surface stays open even when set", () => {
  it("leaves GET reads open (meeting detail, list)", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(middleware(mk("/api/meetings/abc")))).toBe(true);
    expect(isPassThrough(middleware(mk("/api/meetings")))).toBe(true);
  });

  it("leaves GET /api/search open", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(middleware(mk("/api/search?q=budget")))).toBe(true);
  });

  it("leaves export + audio open", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      isPassThrough(middleware(mk("/api/meetings/abc/export")))
    ).toBe(true);
    expect(isPassThrough(middleware(mk("/api/audio/meetings/abc/a.mp3")))).toBe(
      true
    );
  });

  it("leaves the public generate routes open (POST /api/meetings, /api/upload)", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      isPassThrough(middleware(mk("/api/meetings", { method: "POST" })))
    ).toBe(true);
    expect(
      isPassThrough(middleware(mk("/api/upload", { method: "POST" })))
    ).toBe(true);
  });

  it("leaves public pages open (home, library detail, search)", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(middleware(mk("/")))).toBe(true);
    expect(isPassThrough(middleware(mk("/meetings/abc")))).toBe(true);
    expect(isPassThrough(middleware(mk("/search")))).toBe(true);
    expect(isPassThrough(middleware(mk("/study-notes")))).toBe(true);
  });

  it("leaves the public submit forms open (generation is open-with-guardrails)", () => {
    process.env.OWNER_SECRET = SECRET;
    // /meetings/new and /study-notes/new are PUBLIC: the public submits and an
    // admin approves later, so the forms stay reachable even when the secret is set.
    expect(isPassThrough(middleware(mk("/meetings/new")))).toBe(true);
    expect(isPassThrough(middleware(mk("/study-notes/new")))).toBe(true);
  });

  it("opens the /schedules page (public) and keeps /review gated", () => {
    process.env.OWNER_SECRET = SECRET;
    // /schedules is now public (one-off capture is open-with-guardrails like
    // the submit forms); only /review stays gated.
    expect(isPassThrough(middleware(mk("/schedules")))).toBe(true);
    expect(isPassThrough(middleware(mk("/schedules/new")))).toBe(true);
    expect(isPassThrough(middleware(mk("/review")))).toBe(false);
  });

  it("excludes the already-secret-gated tick + Recall webhook", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      isPassThrough(middleware(mk("/api/jobs/tick", { method: "POST" })))
    ).toBe(true);
    expect(
      isPassThrough(
        middleware(mk("/api/webhooks/recall", { method: "POST" }))
      )
    ).toBe(true);
  });

  it("leaves the owner-login page + routes open (no redirect loop)", () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(middleware(mk("/owner-login")))).toBe(true);
    expect(
      isPassThrough(middleware(mk("/api/owner-login", { method: "POST" })))
    ).toBe(true);
  });
});
