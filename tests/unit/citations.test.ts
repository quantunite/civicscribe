// Citation deep links (Phase 2). A citation is a stable link to ONE utterance
// on a meeting detail page: /meetings/<meetingId>#u-<utteranceId>. The anchor
// matches the id TranscriptList renders + scrolls/flashes to. citationPath is
// relative (for in-app <Link>); citationUrl prefixes a base origin so the
// copied link is shareable off-site.

import { describe, expect, it } from "vitest";

import {
  citationPath,
  citationUrl,
  utteranceAnchor,
} from "@/lib/citations";

describe("utteranceAnchor", () => {
  it("builds the #u-<id> anchor the transcript renders", () => {
    expect(utteranceAnchor("abc")).toBe("#u-abc");
  });

  it("percent-encodes an id with unsafe characters", () => {
    // The id flows into a URL fragment; a stray '#' or space must not break it.
    expect(utteranceAnchor("a b#c")).toBe("#u-a%20b%23c");
  });
});

describe("citationPath", () => {
  it("links to the utterance anchor on the meeting page", () => {
    expect(citationPath("m1", "u1")).toBe("/meetings/m1#u-u1");
  });

  it("encodes both ids", () => {
    expect(citationPath("m 1", "u#1")).toBe("/meetings/m%201#u-u%231");
  });
});

describe("citationUrl", () => {
  it("joins a base origin with the citation path", () => {
    expect(citationUrl("https://civic.example.com", "m1", "u1")).toBe(
      "https://civic.example.com/meetings/m1#u-u1"
    );
  });

  it("does not double a trailing slash on the base", () => {
    expect(citationUrl("https://civic.example.com/", "m1", "u1")).toBe(
      "https://civic.example.com/meetings/m1#u-u1"
    );
  });

  it("falls back to the path when the base is empty", () => {
    // An empty/unknown origin still yields a usable in-app link.
    expect(citationUrl("", "m1", "u1")).toBe("/meetings/m1#u-u1");
  });
});
