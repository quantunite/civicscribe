// Caption fast-lane config: defaults and env overrides.

import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

const KEYS = ["CAPTION_FASTLANE", "CAPTION_LANGS", "CAPTION_FETCH_TIMEOUT_MS"];

describe("caption config", () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("defaults: enabled, en-first langs, 60s timeout", () => {
    for (const k of KEYS) delete process.env[k];
    const c = getConfig();
    expect(c.captionFastLane).toBe(true);
    expect(c.captionLangs).toEqual(["en", "en-US", "en-GB", "en-orig"]);
    expect(c.captionFetchTimeoutMs).toBe(60000);
  });

  it("honors env overrides", () => {
    process.env.CAPTION_FASTLANE = "false";
    process.env.CAPTION_LANGS = "es, fr";
    process.env.CAPTION_FETCH_TIMEOUT_MS = "12000";
    const c = getConfig();
    expect(c.captionFastLane).toBe(false);
    expect(c.captionLangs).toEqual(["es", "fr"]);
    expect(c.captionFetchTimeoutMs).toBe(12000);
  });
});
