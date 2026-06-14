// isAdminCookie: the server-component-side admin check. The async root layout
// reads the cs-owner cookie via next/headers cookies() and passes its value
// here to decide whether to render admin-only UI (Review link, sign-out, manage
// actions). It constant-time compares the cookie value to OWNER_SECRET.
//
// HARD INVARIANT (mirrors isAdminRequest): when OWNER_SECRET is unset this is a
// COMPLETE no-op and returns true for everyone (open/dev mode), so the public
// dashboard shows every meeting and the existing suite is unaffected.

import { afterEach, describe, expect, it } from "vitest";

import { isAdminCookie } from "@/lib/owner";

afterEach(() => {
  delete process.env.OWNER_SECRET;
});

describe("isAdminCookie — no-op when OWNER_SECRET is unset", () => {
  it("returns true for a null cookie when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    expect(isAdminCookie(null)).toBe(true);
  });

  it("returns true even for a garbage cookie when the secret is unset", () => {
    delete process.env.OWNER_SECRET;
    expect(isAdminCookie("anything")).toBe(true);
  });

  it("treats a blank OWNER_SECRET as unset (open mode)", () => {
    process.env.OWNER_SECRET = "   ";
    expect(isAdminCookie(null)).toBe(true);
  });
});

describe("isAdminCookie — enforced when OWNER_SECRET is set", () => {
  it("returns true for the correct cookie value", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminCookie("s3cret")).toBe(true);
  });

  it("returns false for a wrong cookie value", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminCookie("wrongXX")).toBe(false);
  });

  it("returns false for a null cookie", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(isAdminCookie(null)).toBe(false);
  });
});
