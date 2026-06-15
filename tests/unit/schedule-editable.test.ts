import { describe, it, expect } from "vitest";

import { isScheduleEditable } from "@/lib/schedule/editable";

describe("isScheduleEditable", () => {
  const now = 1_700_000_000_000;

  it("is editable when the next fire is in the future", () => {
    expect(isScheduleEditable(new Date(now + 60_000).toISOString(), now)).toBe(
      true
    );
  });

  it("is not editable once the next fire is in the past", () => {
    expect(isScheduleEditable(new Date(now - 60_000).toISOString(), now)).toBe(
      false
    );
  });

  it("is not editable at exactly now (it is starting)", () => {
    expect(isScheduleEditable(new Date(now).toISOString(), now)).toBe(false);
  });

  it("is not editable for an unparseable instant", () => {
    expect(isScheduleEditable("not-a-date", now)).toBe(false);
  });
});
