// isAdminRequest: the single centralized admin check. It reads the cs-owner
// cookie OR an Authorization: Bearer header and constant-time compares it to
// OWNER_SECRET via the shared isAuthorized() helper. HARD INVARIANT: when
// OWNER_SECRET is unset the check is a COMPLETE no-op and returns true for
// everyone (open/dev mode), so the rest of the suite runs unchanged.

import { afterEach, describe, expect, it } from "vitest";

import { isAdminRequest } from "@/lib/owner";

const COOKIE = "cs-owner";

afterEach(() => {
  delete process.env.OWNER_SECRET;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/meetings/abc", { headers });
}

describe("isAdminRequest — no-op when OWNER_SECRET is unset", () => {
  it("returns true for a bare request when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    expect(isAdminRequest(req())).toBe(true);
  });

  it("returns true even with garbage credentials when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    expect(
      isAdminRequest(
        req({ cookie: `${COOKIE}=anything`, authorization: "Bearer nope" })
      )
    ).toBe(true);
  });

  it("treats a blank OWNER_SECRET as unset (open mode)", () => {
    process.env.OWNER_SECRET = "   ";
    expect(isAdminRequest(req())).toBe(true);
  });
});

describe("isAdminRequest — enforced when OWNER_SECRET is set", () => {
  it("returns true with the correct cs-owner cookie", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminRequest(req({ cookie: `${COOKIE}=s3cret` }))).toBe(true);
  });

  it("returns true with the correct cookie among other cookies", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(
      isAdminRequest(req({ cookie: `theme=dark; ${COOKIE}=s3cret; lang=en` }))
    ).toBe(true);
  });

  it("returns true with a correct Authorization: Bearer header", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminRequest(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });

  it("returns false with a wrong cookie value", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminRequest(req({ cookie: `${COOKIE}=wrongXX` }))).toBe(false);
  });

  it("returns false with a wrong Bearer token", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminRequest(req({ authorization: "Bearer wrongXX" }))).toBe(false);
  });

  it("returns false with no credentials at all", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminRequest(req())).toBe(false);
  });

  it("accepts the cookie when both are present and the cookie matches", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(
      isAdminRequest(
        req({ cookie: `${COOKIE}=s3cret`, authorization: "Bearer nope" })
      )
    ).toBe(true);
  });

  it("accepts the Bearer when the cookie is wrong but the Bearer matches", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(
      isAdminRequest(
        req({ cookie: `${COOKIE}=wrongXX`, authorization: "Bearer s3cret" })
      )
    ).toBe(true);
  });
});
