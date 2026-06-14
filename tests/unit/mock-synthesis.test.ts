// The mock SummaryProvider.synthesizeTopic must produce deterministic markdown
// that references every given meeting (so MOCK_MODE generation is meaningful and
// tests can assert on it), names the topic, and never uses an em dash.

import { describe, expect, it } from "vitest";

import { MockSummaryProvider } from "@/lib/providers/mock/summary";
import type { TopicSynthesisInput } from "@/lib/providers/types";

const EM_DASH = "—";

const INPUT: TopicSynthesisInput = {
  topic: "Zoning",
  meetings: [
    {
      title: "January Council",
      date: "2026-01-05T00:00:00.000Z",
      overview: "Discussed the Oak Street rezoning.",
      keyPoints: ["Approved variance Z-1 (5-2)"],
    },
    {
      title: "February Council",
      date: "2026-02-09T00:00:00.000Z",
      overview: "Revisited downtown zoning overlay.",
      keyPoints: ["Tabled the overlay"],
    },
  ],
};

describe("MockSummaryProvider.synthesizeTopic", () => {
  it("returns markdown that names the topic", async () => {
    const out = await new MockSummaryProvider().synthesizeTopic(INPUT);
    expect(out).toContain("Zoning");
  });

  it("references every provided meeting by title", async () => {
    const out = await new MockSummaryProvider().synthesizeTopic(INPUT);
    expect(out).toContain("January Council");
    expect(out).toContain("February Council");
  });

  it("is deterministic for the same input", async () => {
    const provider = new MockSummaryProvider();
    const a = await provider.synthesizeTopic(INPUT);
    const b = await provider.synthesizeTopic(INPUT);
    expect(a).toBe(b);
  });

  it("never emits an em dash", async () => {
    const out = await new MockSummaryProvider().synthesizeTopic(INPUT);
    expect(out).not.toContain(EM_DASH);
  });
});
