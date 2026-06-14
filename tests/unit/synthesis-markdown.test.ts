// The lightweight markdown parser behind SynthesisMarkdown. Tests are node-env
// (no jsdom/RTL), so we test the pure parseSynthesisMarkdown(content) function:
// it must classify headings, paragraphs, and bullet lists, and split bold spans.

import { describe, expect, it } from "vitest";

import { parseSynthesisMarkdown } from "@/components/topics/synthesis-markdown";

describe("parseSynthesisMarkdown", () => {
  it("parses an h2 heading", () => {
    const blocks = parseSynthesisMarkdown("## The throughline");
    expect(blocks).toEqual([
      { type: "heading", level: 2, spans: [{ text: "The throughline", bold: false }] },
    ]);
  });

  it("parses an h3 heading", () => {
    const blocks = parseSynthesisMarkdown("### Open questions");
    expect(blocks[0]).toEqual({
      type: "heading",
      level: 3,
      spans: [{ text: "Open questions", bold: false }],
    });
  });

  it("parses a paragraph", () => {
    const blocks = parseSynthesisMarkdown("This is a plain paragraph.");
    expect(blocks).toEqual([
      { type: "paragraph", spans: [{ text: "This is a plain paragraph.", bold: false }] },
    ]);
  });

  it("groups consecutive '-' bullet lines into a single list", () => {
    const blocks = parseSynthesisMarkdown("- first\n- second\n- third");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("list");
    if (blocks[0].type === "list") {
      expect(blocks[0].items).toHaveLength(3);
      expect(blocks[0].items[0]).toEqual([{ text: "first", bold: false }]);
      expect(blocks[0].items[2]).toEqual([{ text: "third", bold: false }]);
    }
  });

  it("also accepts '*' bullets", () => {
    const blocks = parseSynthesisMarkdown("* one\n* two");
    expect(blocks[0].type).toBe("list");
    if (blocks[0].type === "list") {
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it("splits **bold** spans within text", () => {
    const blocks = parseSynthesisMarkdown("Plain **strong** tail");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      spans: [
        { text: "Plain ", bold: false },
        { text: "strong", bold: true },
        { text: " tail", bold: false },
      ],
    });
  });

  it("splits bold spans inside list items", () => {
    const blocks = parseSynthesisMarkdown("- **January Council** (2026-01-05): rezoning");
    expect(blocks[0].type).toBe("list");
    if (blocks[0].type === "list") {
      expect(blocks[0].items[0]).toEqual([
        { text: "January Council", bold: true },
        { text: " (2026-01-05): rezoning", bold: false },
      ]);
    }
  });

  it("separates blocks across blank lines and mixes headings, paragraphs, lists", () => {
    const md = [
      "## Heading",
      "",
      "A paragraph.",
      "",
      "- item one",
      "- item two",
      "",
      "Closing paragraph.",
    ].join("\n");

    const blocks = parseSynthesisMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "paragraph",
    ]);
  });

  it("ignores blank-only input", () => {
    expect(parseSynthesisMarkdown("\n\n   \n")).toEqual([]);
  });
});
