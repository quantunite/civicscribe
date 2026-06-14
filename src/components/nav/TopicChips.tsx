// Render a summary's free-text topics as chips that link to the public
// /tags/[slug] browse surface. Server-safe (no "use client"): pure props.
//
// A topic that has no slug-able characters (topicSlug -> "") has no browse page,
// so it renders as a plain, non-interactive chip rather than a dead link.
// Duplicate slugs (two spellings of one topic on one summary) collapse to a
// single chip so the row never shows the same destination twice.

import Link from "next/link";

import { topicSlug } from "@/lib/topics";

const baseChip =
  "inline-flex items-center rounded-full border px-3 py-1 text-base font-medium";

const linkChip = `${baseChip} border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100 hover:text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2`;

const staticChip = `${baseChip} border-slate-300 bg-slate-100 text-slate-800`;

export function TopicChips({
  topics,
  className,
}: {
  topics: string[];
  className?: string;
}) {
  if (topics.length === 0) return null;

  // Collapse spellings that share a slug; keep the first spelling as the label.
  const seen = new Set<string>();
  const chips: Array<{ key: string; slug: string; label: string }> = [];
  for (const topic of topics) {
    const slug = topicSlug(topic);
    const key = slug || `static:${topic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ key, slug, label: topic });
  }

  return (
    <ul className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {chips.map(({ key, slug, label }) => (
        <li key={key}>
          {slug ? (
            <Link href={`/tags/${slug}`} className={linkChip}>
              {label}
            </Link>
          ) : (
            <span className={staticChip}>{label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
