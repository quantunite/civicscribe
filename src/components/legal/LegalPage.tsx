// Shared renderer for the static legal pages (/terms, /privacy). Content is
// passed as structured blocks rather than raw JSX so the long prose — which is
// full of quotes and apostrophes — renders through {expressions} and never trips
// react/no-unescaped-entities, and so both documents share one consistent style.

import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

export type LegalBlock =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "callout"; text: string }
  | { kind: "contact"; intro: string; email: string };

function renderBlock(block: LegalBlock, key: number) {
  switch (block.kind) {
    case "h2":
      return (
        <h2
          key={key}
          className="mt-10 text-2xl font-semibold tracking-tight text-ink"
        >
          {block.text}
        </h2>
      );
    case "h3":
      return (
        <h3 key={key} className="mt-6 text-lg font-semibold text-ink">
          {block.text}
        </h3>
      );
    case "p":
      return (
        <p key={key} className="mt-3 text-base leading-[1.7] text-ink-soft">
          {block.text}
        </p>
      );
    case "ul":
      return (
        <ul
          key={key}
          className="mt-3 list-disc space-y-1.5 pl-6 text-base leading-[1.7] text-ink-soft"
        >
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <p
          key={key}
          className="mt-4 rounded-lg border border-line-strong bg-primary-soft px-4 py-3 text-base font-medium leading-[1.7] text-ink"
        >
          {block.text}
        </p>
      );
    case "contact":
      return (
        <p key={key} className="mt-3 text-base leading-[1.7] text-ink-soft">
          {block.intro}{" "}
          <a
            href={`mailto:${block.email}`}
            className="font-medium text-accent underline underline-offset-4 hover:text-accent-strong"
          >
            {block.email}
          </a>
          .
        </p>
      );
  }
}

export function LegalPage({
  title,
  updated,
  blocks,
}: {
  title: string;
  updated: string;
  blocks: LegalBlock[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ label: title }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">Last updated: {updated}</p>
      <div className="mt-4">{blocks.map((b, i) => renderBlock(b, i))}</div>
    </div>
  );
}
