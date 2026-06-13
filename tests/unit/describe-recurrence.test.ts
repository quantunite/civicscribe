import { describe, expect, it } from "vitest";

import { describeRecurrence } from "@/lib/schedule/describe";

describe("describeRecurrence", () => {
  it("summarizes a weekly recurrence", () => {
    expect(
      describeRecurrence({
        freq: "weekly",
        weekday: 2,
        time: "18:00",
        timezone: "America/Chicago",
      })
    ).toBe("Every Tuesday at 18:00 · America/Chicago");
  });

  it("summarizes an every-N-weeks recurrence", () => {
    expect(
      describeRecurrence({
        freq: "weekly",
        weekday: 1,
        time: "09:30",
        timezone: "America/New_York",
        interval: 2,
      })
    ).toBe("Every 2 weeks on Monday at 09:30 · America/New_York");
  });

  it("summarizes a monthly nth-weekday recurrence", () => {
    expect(
      describeRecurrence({
        freq: "monthly",
        weekday: 2,
        nth: 2,
        time: "18:00",
        timezone: "America/Chicago",
      })
    ).toBe("2nd Tuesday of each month at 18:00 · America/Chicago");
  });

  it("summarizes a last-weekday monthly recurrence", () => {
    expect(
      describeRecurrence({
        freq: "monthly",
        weekday: 5,
        nth: -1,
        time: "12:00",
        timezone: "UTC",
      })
    ).toBe("last Friday of each month at 12:00 · UTC");
  });
});
