// isAuthorized: constant-time bearer/secret check for the tick + Recall webhook
// routes. Open by default (no secret configured) so the app still boots with
// only MOCK_MODE=true; enforced once a secret is set for public deploy.

import { describe, expect, it } from "vitest";

import { isAuthorized } from "@/lib/auth";

describe("isAuthorized", () => {
  it("allows any request when no secret is configured", () => {
    expect(isAuthorized(null, null)).toBe(true);
    expect(isAuthorized("Bearer anything", null)).toBe(true);
    expect(isAuthorized(null, "")).toBe(true);
  });

  it("accepts a matching Bearer token", () => {
    expect(isAuthorized("Bearer s3cret-value", "s3cret-value")).toBe(true);
  });

  it("accepts a matching raw secret value (no Bearer prefix)", () => {
    expect(isAuthorized("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects a wrong token of equal length", () => {
    expect(isAuthorized("Bearer s3cret-valuX", "s3cret-value")).toBe(false);
  });

  it("rejects a missing token when a secret is configured", () => {
    expect(isAuthorized(null, "s3cret-value")).toBe(false);
    expect(isAuthorized("", "s3cret-value")).toBe(false);
  });

  it("rejects (without throwing) when the lengths differ", () => {
    expect(isAuthorized("Bearer short", "a-much-longer-secret-value")).toBe(
      false
    );
  });
});
