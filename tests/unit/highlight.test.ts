// highlightSegments: stem-aware match highlighting. Bug 1 was that the
// highlighter built a regex from the literal query token, but Postgres FTS
// stems ("zoning" matches an utterance saying "zoned"), so a correctly-matched
// row showed zero highlights. The highlighter must mark what FTS matched.

import { describe, expect, it } from "vitest";

import { highlightSegments, tokenize } from "@/lib/text/highlight";

function marked(text: string, query: string): string[] {
  return highlightSegments(text, tokenize(query))
    .filter((s) => s.marked)
    .map((s) => s.text);
}

describe("highlightSegments", () => {
  it("marks a literal whole-word match", () => {
    expect(marked("Zoning was approved", "zoning")).toEqual(["Zoning"]);
  });

  it("marks a stemmed match the literal query token would miss (Bug 1)", () => {
    expect(marked("The land was zoned commercial", "zoning")).toContain("zoned");
  });

  it("marks a word that contains the query token as a substring", () => {
    // "drain" stems to "drain" but "drainage" stems to "drainag"; substring
    // coverage keeps the literal-match behavior the old highlighter had.
    expect(marked("The drainage plan", "drain")).toContain("drainage");
  });

  it("does not mark unrelated words", () => {
    const segs = highlightSegments("The budget meeting ran late", tokenize("zoning"));
    expect(segs.some((s) => s.marked)).toBe(false);
  });

  it("marks every query token (multi-word AND)", () => {
    const m = marked("The drainage plan was distributed", "drainage plan");
    expect(m).toContain("drainage");
    expect(m).toContain("plan");
  });

  it("is case-insensitive against upper-case text", () => {
    expect(marked("PLEASE MAKE THE DRAINAGE PLAN REAL", "drainage")).toContain(
      "DRAINAGE"
    );
  });

  it("reconstructs the original text from its segments in order", () => {
    const text = "Zoning, drainage & the plan.";
    const joined = highlightSegments(text, tokenize("zoning plan"))
      .map((s) => s.text)
      .join("");
    expect(joined).toBe(text);
  });

  it("returns the whole text as one unmarked segment for an empty query", () => {
    expect(highlightSegments("anything here", tokenize(""))).toEqual([
      { text: "anything here", marked: false },
    ]);
  });
});
