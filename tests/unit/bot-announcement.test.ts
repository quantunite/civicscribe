// The bot's join announcement is posted to all participants via Recall's chat
// API. Two invariants matter: it must carry the recording notice + legal basis,
// and it must stay under Google Meet's 500-char chat cap (Zoom/Teams allow 4096)
// so it is not silently truncated on Meet. This guards both as clauses are added.

import { describe, expect, it } from "vitest";

import { BOT_ANNOUNCEMENT } from "@/lib/providers/real/recall";

describe("bot join announcement", () => {
  it("identifies as CivicScribe and states it is recording", () => {
    expect(BOT_ANNOUNCEMENT).toContain("CivicScribe");
    expect(BOT_ANNOUNCEMENT.toLowerCase()).toContain("recording");
  });

  it("cites the Massachusetts legal basis for recording an open meeting", () => {
    expect(BOT_ANNOUNCEMENT).toContain("Massachusetts Open Meeting Law");
    expect(BOT_ANNOUNCEMENT).toContain("G.L. c. 30A");
  });

  it("stays under the 500-char Google Meet chat cap", () => {
    expect(BOT_ANNOUNCEMENT.length).toBeLessThanOrEqual(500);
  });
});
