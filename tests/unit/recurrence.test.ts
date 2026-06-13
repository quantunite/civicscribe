// Recurrence math: firstFireAfter (initial next_fire_at) and nextFire (advance
// after an occurrence). DST correctness matters — civic meetings keep their
// local wall-clock time across the spring/fall transitions.

import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { firstFireAfter, nextFire } from "@/lib/schedule/recurrence";
import type { Recurrence } from "@/lib/types";

const CHI = "America/Chicago";

/** Assert an instant lands on the expected local weekday + wall time in a zone. */
function expectLocal(
  date: Date,
  zone: string,
  weekday: number, // 0=Sun..6=Sat
  hhmm: string
) {
  const dt = DateTime.fromJSDate(date, { zone });
  const luxonWeekday = weekday === 0 ? 7 : weekday;
  expect(dt.weekday).toBe(luxonWeekday);
  expect(dt.toFormat("HH:mm")).toBe(hhmm);
}

describe("firstFireAfter — weekly", () => {
  const rec: Recurrence = {
    freq: "weekly",
    weekday: 2, // Tuesday
    time: "18:00",
    timezone: CHI,
  };

  it("returns the next Tuesday 18:00 strictly after the given instant", () => {
    // 2026-07-08 is a Wednesday; next Tuesday is 2026-07-14.
    const after = new Date("2026-07-08T12:00:00.000Z");
    const fire = firstFireAfter(rec, after);
    expect(fire.toISOString()).toBe("2026-07-14T23:00:00.000Z"); // 18:00 CDT
    expectLocal(fire, CHI, 2, "18:00");
  });

  it("skips to next week when the same-day occurrence has already passed", () => {
    // 2026-07-14 is a Tuesday; 20:00 UTC is past 18:00 CDT (23:00 UTC)? No —
    // 18:00 CDT = 23:00 UTC, so 20:00 UTC is BEFORE it: should fire same day.
    const beforeTime = new Date("2026-07-14T20:00:00.000Z");
    expect(firstFireAfter(rec, beforeTime).toISOString()).toBe(
      "2026-07-14T23:00:00.000Z"
    );
    // 23:30 UTC is AFTER 18:00 CDT: must skip to next Tuesday.
    const afterTime = new Date("2026-07-14T23:30:00.000Z");
    expect(firstFireAfter(rec, afterTime).toISOString()).toBe(
      "2026-07-21T23:00:00.000Z"
    );
  });
});

describe("firstFireAfter — monthly nth weekday", () => {
  it("finds the 2nd Tuesday of the month at local time", () => {
    const rec: Recurrence = {
      freq: "monthly",
      weekday: 2,
      nth: 2,
      time: "18:00",
      timezone: CHI,
    };
    // July 2026 Tuesdays: 7, 14, 21, 28 -> 2nd = the 14th.
    const fire = firstFireAfter(rec, new Date("2026-07-01T00:00:00.000Z"));
    expect(fire.toISOString()).toBe("2026-07-14T23:00:00.000Z");
  });

  it("finds the last Friday of the month (nth = -1)", () => {
    const rec: Recurrence = {
      freq: "monthly",
      weekday: 5,
      nth: -1,
      time: "18:00",
      timezone: CHI,
    };
    // July 2026 Fridays: 3, 10, 17, 24, 31 -> last = the 31st.
    const fire = firstFireAfter(rec, new Date("2026-07-01T00:00:00.000Z"));
    expect(fire.toISOString()).toBe("2026-07-31T23:00:00.000Z");
  });

  it("rolls to next month when this month's occurrence has passed", () => {
    const rec: Recurrence = {
      freq: "monthly",
      weekday: 2,
      nth: 2,
      time: "18:00",
      timezone: CHI,
    };
    // After the 2nd Tuesday of July -> next is the 2nd Tuesday of August (11th).
    const fire = firstFireAfter(rec, new Date("2026-07-20T00:00:00.000Z"));
    expect(fire.toISOString()).toBe("2026-08-11T23:00:00.000Z");
  });
});

describe("nextFire — advances from a known occurrence", () => {
  it("weekly default interval adds one week, keeping wall time", () => {
    const rec: Recurrence = {
      freq: "weekly",
      weekday: 2,
      time: "18:00",
      timezone: CHI,
    };
    const next = nextFire(rec, new Date("2026-07-14T23:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-21T23:00:00.000Z");
  });

  it("weekly interval 2 adds two weeks", () => {
    const rec: Recurrence = {
      freq: "weekly",
      weekday: 2,
      time: "18:00",
      timezone: CHI,
      interval: 2,
    };
    const next = nextFire(rec, new Date("2026-07-14T23:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-28T23:00:00.000Z");
  });

  it("keeps 18:00 local across the fall DST transition (offset shifts)", () => {
    // US fall-back 2026: Sunday Nov 1. A weekly Tuesday before vs after:
    // Oct 27 is CDT (18:00 = 23:00Z); Nov 3 is CST (18:00 = 00:00Z next day).
    const rec: Recurrence = {
      freq: "weekly",
      weekday: 2,
      time: "18:00",
      timezone: CHI,
    };
    const next = nextFire(rec, new Date("2026-10-27T23:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expectLocal(next, CHI, 2, "18:00");
  });

  it("monthly advances to next month's nth weekday", () => {
    const rec: Recurrence = {
      freq: "monthly",
      weekday: 2,
      nth: 2,
      time: "18:00",
      timezone: CHI,
    };
    const next = nextFire(rec, new Date("2026-07-14T23:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-11T23:00:00.000Z");
  });
});
