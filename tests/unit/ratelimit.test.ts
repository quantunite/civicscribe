// In-process daily rate limiter (src/lib/ratelimit.ts).
//
// checkAndConsume(key, limit, now?) counts a key up to `limit` per UTC day and
// blocks past it, exposing the remaining headroom. The day is derived from an
// injectable `now` so a new day resets every key's counter without real time
// passing. State is module-level, so each test resets it first.

import { beforeEach, describe, expect, it } from "vitest";

import { checkAndConsume, __resetRateLimitsForTests } from "@/lib/ratelimit";

const DAY1 = new Date("2026-06-14T08:00:00Z");
const DAY1_LATE = new Date("2026-06-14T23:59:59Z");
const DAY2 = new Date("2026-06-15T00:00:01Z");

beforeEach(() => {
  __resetRateLimitsForTests();
});

describe("checkAndConsume", () => {
  it("allows calls up to the limit, decrementing remaining each time", () => {
    expect(checkAndConsume("ip:1.2.3.4", 3, DAY1)).toEqual({
      allowed: true,
      remaining: 2,
    });
    expect(checkAndConsume("ip:1.2.3.4", 3, DAY1)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(checkAndConsume("ip:1.2.3.4", 3, DAY1)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it("blocks the call past the limit without consuming further", () => {
    for (let i = 0; i < 3; i++) checkAndConsume("ip:1.2.3.4", 3, DAY1);

    expect(checkAndConsume("ip:1.2.3.4", 3, DAY1)).toEqual({
      allowed: false,
      remaining: 0,
    });
    // A blocked call must not deepen the deficit: still 0, still blocked.
    expect(checkAndConsume("ip:1.2.3.4", 3, DAY1)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("counts keys independently", () => {
    checkAndConsume("ip:1.1.1.1", 1, DAY1);
    // A different key is untouched by the first key's exhaustion.
    expect(checkAndConsume("ip:2.2.2.2", 1, DAY1)).toEqual({
      allowed: true,
      remaining: 0,
    });
    expect(checkAndConsume("ip:1.1.1.1", 1, DAY1)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("does not reset within the same UTC day", () => {
    checkAndConsume("ip:1.2.3.4", 1, DAY1);
    // Later the same day: still over the limit.
    expect(checkAndConsume("ip:1.2.3.4", 1, DAY1_LATE)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("resets every key's counter on a new UTC day", () => {
    checkAndConsume("ip:1.2.3.4", 1, DAY1);
    expect(checkAndConsume("ip:1.2.3.4", 1, DAY1)).toEqual({
      allowed: false,
      remaining: 0,
    });
    // New day: the counter is fresh again.
    expect(checkAndConsume("ip:1.2.3.4", 1, DAY2)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it("treats a limit of 0 as always blocked", () => {
    expect(checkAndConsume("ip:1.2.3.4", 0, DAY1)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("defaults `now` to the current time when omitted", () => {
    // Two calls with the real clock land on the same day, so a limit of 1
    // allows the first and blocks the second.
    expect(checkAndConsume("ip:default-now", 1).allowed).toBe(true);
    expect(checkAndConsume("ip:default-now", 1).allowed).toBe(false);
  });
});
