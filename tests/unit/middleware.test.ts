// Edge middleware: the access boundary on the ADMIN surface.
//
// HARD INVARIANT: when BOTH OWNER_SECRET and SESSION_SECRET are unset the
// middleware is a COMPLETE pass-through (no-op) so dev + the whole suite are
// unaffected. When either is set, the admin surface needs a credential: the
// cs-owner cookie / Bearer (OWNER_SECRET) OR a valid cs-session token. /api/*
// gets a 401 JSON, pages get a redirect to /owner-login. Public reads, search,
// export, audio, and the public generate routes stay open.

import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";

const SECRET = "s3cret";
const SESSION_SECRET = "sess3cret";

afterEach(() => {
  delete process.env.OWNER_SECRET;
  delete process.env.SESSION_SECRET;
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

/** Mint a `cs-session=<token>` cookie string for tests. */
async function sessionCookie(
  role: "admin" | "moderator" | "user",
  opts: { expOffset?: number } = {}
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (opts.expOffset ?? 3600);
  const token = await signSession({ uid: "u1", role, exp }, SESSION_SECRET);
  return `${SESSION_COOKIE}=${token}`;
}

describe("middleware — no-op when both secrets are unset", () => {
  it("passes through a gated DELETE when neither secret is set", async () => {
    const res = await middleware(mk("/api/meetings/abc", { method: "DELETE" }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("passes through a gated page when neither secret is set", async () => {
    const res = await middleware(mk("/review"));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — OWNER_SECRET (break-glass) gating", () => {
  it("401s an unauthenticated DELETE /api/meetings/[id]", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(mk("/api/meetings/abc", { method: "DELETE" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("401s an unauthenticated PATCH /api/utterances/[id]", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(mk("/api/utterances/u1", { method: "PATCH" }));
    expect(res.status).toBe(401);
  });

  it("passes through POST /api/schedules (decided in-handler)", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(mk("/api/schedules", { method: "POST" }));
    expect(isPassThrough(res)).toBe(true);
  });

  it("401s unauthenticated PATCH and DELETE /api/schedules/[id]", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      (await middleware(mk("/api/schedules/s1", { method: "PATCH" }))).status
    ).toBe(401);
    expect(
      (await middleware(mk("/api/schedules/s1", { method: "DELETE" }))).status
    ).toBe(401);
  });

  it("401s the publish + unpublish endpoints", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      (await middleware(mk("/api/meetings/abc/publish", { method: "POST" })))
        .status
    ).toBe(401);
    expect(
      (await middleware(mk("/api/meetings/abc/unpublish", { method: "POST" })))
        .status
    ).toBe(401);
  });

  it("allows the gated /api call with the correct cookie", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", { method: "DELETE", cookie: `cs-owner=${SECRET}` })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("allows the gated /api call with the correct Bearer", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", { method: "DELETE", bearer: SECRET })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("redirects a gated page to /owner-login", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(mk("/review"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/owner-login");
  });

  it("allows the gated page with the correct cookie", async () => {
    process.env.OWNER_SECRET = SECRET;
    const res = await middleware(mk("/review", { cookie: `cs-owner=${SECRET}` }));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — cs-session (per-user) gating", () => {
  it("401s a gated /api call with no session when SESSION_SECRET is set", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(mk("/api/meetings/abc", { method: "DELETE" }));
    expect(res.status).toBe(401);
  });

  it("admits an admin session on a gated /api call", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", {
        method: "DELETE",
        cookie: await sessionCookie("admin"),
      })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("admits a moderator session (Phase 1 treats both as staff)", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", {
        method: "DELETE",
        cookie: await sessionCookie("moderator"),
      })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("rejects a plain user session on the admin surface", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", {
        method: "DELETE",
        cookie: await sessionCookie("user"),
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(
      mk("/api/meetings/abc", {
        method: "DELETE",
        cookie: await sessionCookie("admin", { expOffset: -10 }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("admits an admin session on a gated page", async () => {
    process.env.SESSION_SECRET = SESSION_SECRET;
    const res = await middleware(
      mk("/review", { cookie: await sessionCookie("admin") })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("works alongside OWNER_SECRET when both are set", async () => {
    process.env.OWNER_SECRET = SECRET;
    process.env.SESSION_SECRET = SESSION_SECRET;
    // owner break-glass still works
    expect(
      isPassThrough(
        await middleware(
          mk("/api/meetings/abc", {
            method: "DELETE",
            cookie: `cs-owner=${SECRET}`,
          })
        )
      )
    ).toBe(true);
    // session also works
    expect(
      isPassThrough(
        await middleware(
          mk("/api/meetings/abc", {
            method: "DELETE",
            cookie: await sessionCookie("admin"),
          })
        )
      )
    ).toBe(true);
    // neither -> denied
    expect(
      (await middleware(mk("/api/meetings/abc", { method: "DELETE" }))).status
    ).toBe(401);
  });
});

describe("middleware — public surface stays open even when gated", () => {
  it("leaves GET reads + search open", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(await middleware(mk("/api/meetings/abc")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/api/meetings")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/api/search?q=budget")))).toBe(
      true
    );
  });

  it("leaves export + audio open", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      isPassThrough(await middleware(mk("/api/meetings/abc/export")))
    ).toBe(true);
    expect(
      isPassThrough(await middleware(mk("/api/audio/meetings/abc/a.mp3")))
    ).toBe(true);
  });

  it("leaves the public generate routes open", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(
      isPassThrough(await middleware(mk("/api/meetings", { method: "POST" })))
    ).toBe(true);
    expect(
      isPassThrough(await middleware(mk("/api/upload", { method: "POST" })))
    ).toBe(true);
  });

  it("leaves public pages + submit forms open", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(await middleware(mk("/")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/meetings/abc")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/search")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/meetings/new")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/study-notes/new")))).toBe(true);
  });

  it("opens /schedules (public) and keeps /review gated", async () => {
    process.env.OWNER_SECRET = SECRET;
    expect(isPassThrough(await middleware(mk("/schedules")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/schedules/new")))).toBe(true);
    expect(isPassThrough(await middleware(mk("/review")))).toBe(false);
  });
});
