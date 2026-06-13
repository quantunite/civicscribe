// resolveCaptureUrl: turn a schedule's source_spec into a concrete capture URL
// at fire time. v1 only resolves fixed_url; the interface leaves room for
// channel/playlist resolvers without changing callers.

import { describe, expect, it } from "vitest";

import { resolveCaptureUrl } from "@/lib/schedule/resolver";
import type { ScheduleSourceSpec } from "@/lib/types";

describe("resolveCaptureUrl", () => {
  it("returns the URL for a fixed_url spec", () => {
    const spec: ScheduleSourceSpec = {
      type: "fixed_url",
      url: "https://example.org/live",
    };
    expect(resolveCaptureUrl(spec)).toBe("https://example.org/live");
  });

  it("returns null for a fixed_url spec with a blank url", () => {
    expect(resolveCaptureUrl({ type: "fixed_url", url: "   " })).toBeNull();
  });

  it("returns null for an unknown spec type", () => {
    const unknown = { type: "youtube_channel" } as unknown as ScheduleSourceSpec;
    expect(resolveCaptureUrl(unknown)).toBeNull();
  });
});
