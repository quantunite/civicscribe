// topicSlug: turn a free-text summary topic into a stable, URL-safe slug for
// the /tags/[slug] browse surface. topicMatchesSlug: the reverse-tolerant
// match — because slugs are lossy (case + punctuation collapse), we recover the
// set of topics for a slug by re-slugifying each candidate and comparing.

import { describe, expect, it } from "vitest";

import { topicMatchesSlug, topicSlug } from "@/lib/topics";

describe("topicSlug", () => {
  it("lowercases and hyphenates words", () => {
    expect(topicSlug("Zoning Variance")).toBe("zoning-variance");
  });

  it("collapses punctuation and runs of separators into single hyphens", () => {
    expect(topicSlug("Parks & Recreation")).toBe("parks-recreation");
    expect(topicSlug("budget   /   finance")).toBe("budget-finance");
  });

  it("trims leading and trailing separators", () => {
    expect(topicSlug("  drainage!  ")).toBe("drainage");
    expect(topicSlug("--water--")).toBe("water");
  });

  it("preserves digits", () => {
    expect(topicSlug("Article 12 rezoning")).toBe("article-12-rezoning");
  });

  it("collapses different casings/spacings of the same topic to one slug", () => {
    expect(topicSlug("Public  Safety")).toBe(topicSlug("public safety"));
    expect(topicSlug("PUBLIC-SAFETY")).toBe(topicSlug("Public Safety"));
  });

  it("returns an empty string for a topic with no slug-able characters", () => {
    expect(topicSlug("   ")).toBe("");
    expect(topicSlug("!!!")).toBe("");
  });
});

describe("topicMatchesSlug — reverse-tolerant match", () => {
  it("matches a topic to its own slug", () => {
    expect(topicMatchesSlug("Zoning Variance", "zoning-variance")).toBe(true);
  });

  it("matches regardless of the candidate's casing or punctuation", () => {
    expect(topicMatchesSlug("Parks & Recreation", "parks-recreation")).toBe(
      true
    );
    expect(topicMatchesSlug("public   safety", "public-safety")).toBe(true);
  });

  it("does not match a different topic", () => {
    expect(topicMatchesSlug("drainage", "zoning-variance")).toBe(false);
  });

  it("never matches an empty/unslug-able topic", () => {
    expect(topicMatchesSlug("   ", "")).toBe(false);
    expect(topicMatchesSlug("!!!", "")).toBe(false);
  });
});
