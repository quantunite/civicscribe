// Public-submission guardrails (src/lib/guardrails.ts): client-IP derivation
// and the shared per-IP + global daily submission limiter used by the public
// generate routes (POST /api/meetings, POST /api/upload).
//
// HARD INVARIANT: admin (isAdminRequest) is exempt; and when OWNER_SECRET is
// unset everyone is admin, so the guardrails are a complete no-op in dev and
// MOCK_MODE and the rest of the suite is unaffected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clientIp,
  enforceSubmitGuardrails,
  GLOBAL_RATE_KEY,
} from "@/lib/guardrails";
import { __resetRateLimitsForTests } from "@/lib/ratelimit";

beforeEach(() => {
  __resetRateLimitsForTests();
});

afterEach(() => {
  delete process.env.OWNER_SECRET;
  delete process.env.MAX_SUBMITS_PER_IP_PER_DAY;
  delete process.env.MAX_SUBMITS_GLOBAL_PER_DAY;
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/meetings", {
    method: "POST",
    headers,
  });
}

describe("clientIp", () => {
  it("takes the rightmost public hop of x-forwarded-for (edge-appended client IP)", () => {
    // The real client IP is the last hop our own edge appends. A single
    // private hop (e.g. an internal LB) is skipped.
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7"
    );
  });

  it("trims whitespace around the chosen hop", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "  203.0.113.7 , 10.0.0.1 " }))
    ).toBe("203.0.113.7");
  });

  it("ignores a forged leftmost hop and buckets on the real edge-appended IP", () => {
    // An abuser sends a random public value as the leftmost hop trying to mint
    // a fresh per-IP budget; the edge appends the real client IP on the right.
    // We must bucket on the real (rightmost public) IP, NOT the forged one.
    const forgedA = clientIp(
      req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })
    );
    const forgedB = clientIp(
      req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })
    );
    expect(forgedA).toBe("203.0.113.7");
    expect(forgedB).toBe("203.0.113.7");
    // Rotating the forged leftmost value does NOT change the bucket.
    expect(forgedA).toBe(forgedB);
  });

  it("skips trailing private hops to reach the public client IP", () => {
    expect(
      clientIp(
        req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 192.168.1.1" })
      )
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip rather than trusting the leftmost hop when every XFF hop is internal", () => {
    expect(
      clientIp(
        req({
          "x-forwarded-for": "10.0.0.1, 192.168.1.1",
          "x-real-ip": "198.51.100.4",
        })
      )
    ).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to a sentinel when no usable IP is present", () => {
    expect(clientIp(req())).toBe("unknown");
    // All-internal XFF and no x-real-ip: sentinel, not the spoofable leftmost.
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" }))).toBe(
      "unknown"
    );
  });
});

describe("enforceSubmitGuardrails — admin exempt / no-op when secret unset", () => {
  it("returns null (no-op) for everyone when OWNER_SECRET is unset", () => {
    delete process.env.OWNER_SECRET;
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1";
    // Far past any cap, but open mode means admin=true for everyone -> no-op.
    for (let i = 0; i < 10; i++) {
      expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "1.1.1.1" }))).toBeNull();
    }
  });

  it("exempts the admin even when OWNER_SECRET is set", () => {
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1";
    for (let i = 0; i < 5; i++) {
      const res = enforceSubmitGuardrails(
        req({
          "x-forwarded-for": "1.1.1.1",
          authorization: "Bearer s3cret",
        })
      );
      expect(res).toBeNull();
    }
  });
});

describe("enforceSubmitGuardrails — limits enforced for the public", () => {
  it("returns a 429 once the per-IP daily limit is exceeded", async () => {
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "2";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1000";

    const ip = { "x-forwarded-for": "8.8.8.8" };
    expect(enforceSubmitGuardrails(req(ip))).toBeNull();
    expect(enforceSubmitGuardrails(req(ip))).toBeNull();

    const blocked = enforceSubmitGuardrails(req(ip));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const body = await blocked!.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("a per-IP block for one IP does not affect another IP", () => {
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "1000";

    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "8.8.8.8" }))).toBeNull();
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "8.8.8.8" }))).not.toBeNull();
    // Different IP, fresh per-IP budget.
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "9.9.9.9" }))).toBeNull();
  });

  it("returns a 429 once the global daily limit is exceeded, across IPs", async () => {
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1000";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "2";

    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "1.1.1.1" }))).toBeNull();
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "2.2.2.2" }))).toBeNull();
    const blocked = enforceSubmitGuardrails(req({ "x-forwarded-for": "3.3.3.3" }));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("does not consume the global budget when the per-IP limit already blocked", () => {
    process.env.OWNER_SECRET = "s3cret";
    process.env.MAX_SUBMITS_PER_IP_PER_DAY = "1";
    process.env.MAX_SUBMITS_GLOBAL_PER_DAY = "5";

    const ip = { "x-forwarded-for": "7.7.7.7" };
    expect(enforceSubmitGuardrails(req(ip))).toBeNull(); // global used: 1
    expect(enforceSubmitGuardrails(req(ip))).not.toBeNull(); // per-IP blocks

    // The global counter should only have been charged once (the allowed call),
    // so four more distinct IPs still fit under the global cap of 5.
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "7.7.7.8" }))).toBeNull();
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "7.7.7.9" }))).toBeNull();
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "7.7.7.10" }))).toBeNull();
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "7.7.7.11" }))).toBeNull();
    // Sixth global submission is over the cap.
    expect(enforceSubmitGuardrails(req({ "x-forwarded-for": "7.7.7.12" }))).not.toBeNull();
  });

  it("exposes a stable global rate key", () => {
    expect(typeof GLOBAL_RATE_KEY).toBe("string");
    expect(GLOBAL_RATE_KEY.length).toBeGreaterThan(0);
  });
});
