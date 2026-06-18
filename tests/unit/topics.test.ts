// topicSlug: turn a free-text summary topic into a stable, URL-safe slug for
// the /tags/[slug] browse surface. topicMatchesSlug: the reverse-tolerant
// match — because slugs are lossy (case + punctuation collapse), we recover the
// set of topics for a slug by re-slugifying each candidate and comparing.

import { describe, expect, it } from "vitest";

import {
  aggregateTopics,
  filterMeaningfulTopics,
  isMeaningfulTopic,
  topicMatchesSlug,
  topicSlug,
} from "@/lib/topics";

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

  it("never matches a routine procedural slug (no browse page for it)", () => {
    expect(topicMatchesSlug("Roll Call and Attendance", "roll-call-and-attendance")).toBe(false);
    expect(topicMatchesSlug("Approval of Minutes", "approval-of-minutes")).toBe(false);
    // Phrase variant the exact list alone would miss.
    expect(topicMatchesSlug("Meeting Minutes Approval", "meeting-minutes-approval")).toBe(false);
  });
});

describe("isMeaningfulTopic — drop routine procedural items", () => {
  it("keeps real subject-matter topics", () => {
    expect(isMeaningfulTopic("Zoning Variance")).toBe(true);
    expect(isMeaningfulTopic("Public Safety")).toBe(true);
    // A real topic that merely CONTAINS a procedural word is kept (exact-slug
    // match, never substring).
    expect(isMeaningfulTopic("Agenda for downtown rezoning")).toBe(true);
  });

  it("drops procedural/administrative boilerplate (incl. phrasing variants)", () => {
    for (const t of [
      "Roll Call",
      "Roll call and attendance",
      "Attendance",
      "Approval of the Minutes",
      "Meeting Minutes Approval", // phrase variant, not in the exact list
      "Adjournment",
      "Pledge of Allegiance",
      "Quorum",
    ]) {
      expect(isMeaningfulTopic(t)).toBe(false);
    }
  });

  it("keeps real topics that merely contain a procedural word", () => {
    // Exact-word items never substring-match; only distinctive phrases do.
    expect(isMeaningfulTopic("Ten-minute public comment limit policy")).toBe(true);
    expect(isMeaningfulTopic("Agenda 21 sustainability plan")).toBe(true);
  });

  it("drops empty/unslug-able topics", () => {
    expect(isMeaningfulTopic("   ")).toBe(false);
    expect(isMeaningfulTopic("!!!")).toBe(false);
  });

  it("filterMeaningfulTopics removes procedural entries, preserving order", () => {
    expect(
      filterMeaningfulTopics([
        "Roll Call",
        "Affordable Housing",
        "Approval of Minutes",
        "Stormwater Drainage",
      ])
    ).toEqual(["Affordable Housing", "Stormwater Drainage"]);
  });
});

describe("aggregateTopics — procedural topics never reach the cloud", () => {
  it("excludes procedural topics from buckets and counts", () => {
    const cloud = aggregateTopics([
      { meetingId: "m1", topics: ["Roll Call", "Affordable Housing"] },
      { meetingId: "m2", topics: ["Approval of Minutes", "Affordable Housing"] },
    ]);
    expect(cloud.map((b) => b.slug)).toEqual(["affordable-housing"]);
    expect(cloud[0].count).toBe(2);
  });
});
