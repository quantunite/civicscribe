// A tiny, server-safe Markdown renderer for the cross-meeting synthesis (Phase
// 3). The app ships no markdown dependency, and the synthesis output is a small,
// known subset (## / ### headings, paragraphs, "-"/"*" bullet lists, **bold**).
// Parsing lives in the JSX-free synthesis-markdown module (so it is unit-testable
// in the node-env suite); this component only maps the typed blocks to JSX. No
// raw HTML is injected, so there is no dangerouslySetInnerHTML and nothing to
// escape.

import {
  parseSynthesisMarkdown,
  type Span,
} from "@/components/topics/synthesis-markdown";

// Re-export so the renderer and its pure parser share a single import surface.
export {
  parseSynthesisMarkdown,
  parseSpans,
  type Block,
  type Span,
} from "@/components/topics/synthesis-markdown";

function renderSpans(spans: Span[]) {
  return spans.map((span, i) =>
    span.bold ? (
      <strong key={i} className="font-semibold text-slate-900">
        {span.text}
      </strong>
    ) : (
      <span key={i}>{span.text}</span>
    )
  );
}

export function SynthesisMarkdown({ content }: { content: string }) {
  const blocks = parseSynthesisMarkdown(content);

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return block.level === 2 ? (
            <h2
              key={i}
              className="text-2xl font-bold tracking-tight text-slate-900"
            >
              {renderSpans(block.spans)}
            </h2>
          ) : (
            <h3
              key={i}
              className="text-xl font-bold tracking-tight text-slate-900"
            >
              {renderSpans(block.spans)}
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={i} className="flex flex-col gap-2 pl-1">
              {block.items.map((item, j) => (
                <li
                  key={j}
                  className="flex gap-2 text-lg leading-[1.7] text-slate-800"
                >
                  <span aria-hidden="true" className="mt-0.5 text-teal-700">
                    •
                  </span>
                  <span>{renderSpans(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-lg leading-[1.7] text-slate-800">
            {renderSpans(block.spans)}
          </p>
        );
      })}
    </div>
  );
}
