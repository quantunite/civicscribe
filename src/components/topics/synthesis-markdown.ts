// Pure Markdown parsing for the cross-meeting synthesis (Phase 3). Kept JSX-free
// in its own .ts module so it is importable in the node-env unit tests (vitest
// does not transform .tsx under the project's jsx:preserve tsconfig). The
// SynthesisMarkdown component re-exports this and maps the blocks to JSX.
//
// The synthesis output is a small, known subset of Markdown: ## / ### headings,
// paragraphs, "-"/"*" bullet lists, and **bold** inline spans. No raw HTML is
// ever produced, so there is nothing to sanitize downstream.

/** A run of text, optionally bold. */
export interface Span {
  text: string;
  bold: boolean;
}

export type Block =
  | { type: "heading"; level: 2 | 3; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "list"; items: Span[][] };

/** Split a line of text into bold / non-bold spans on **...** markers. */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      spans.push({ text: text.slice(last, m.index), bold: false });
    }
    spans.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    spans.push({ text: text.slice(last), bold: false });
  }
  if (spans.length === 0) spans.push({ text: "", bold: false });
  return spans;
}

function isBullet(line: string): boolean {
  return /^[-*]\s+/.test(line.trim());
}

function bulletText(line: string): string {
  return line.trim().replace(/^[-*]\s+/, "");
}

/** Parse the supported Markdown subset into typed blocks. Pure and deterministic
 *  so it can be unit-tested without a DOM. */
export function parseSynthesisMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push({
        type: "heading",
        level: 3,
        spans: parseSpans(trimmed.slice(4).trim()),
      });
      i += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push({
        type: "heading",
        level: 2,
        spans: parseSpans(trimmed.slice(3).trim()),
      });
      i += 1;
      continue;
    }

    if (isBullet(trimmed)) {
      const items: Span[][] = [];
      while (i < lines.length && isBullet(lines[i].trim())) {
        items.push(parseSpans(bulletText(lines[i])));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines into one block.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("## ") &&
      !lines[i].trim().startsWith("### ") &&
      !isBullet(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", spans: parseSpans(paraLines.join(" ")) });
  }

  return blocks;
}
