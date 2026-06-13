// Shared presentation helpers for transcript rendering. No "use client"
// directive on purpose: these are pure functions/components usable from both
// server components (search page) and client components (transcript list).

import type { ReactElement } from "react";

import { highlightSegments } from "@/lib/text/highlight";

/** Format milliseconds as [h:]mm:ss, e.g. 754000 -> "12:34", 5025000 -> "1:23:45". */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Resolved display name for an utterance speaker. */
export function speakerDisplayName(
  speakerName: string | null,
  speakerLabel: string
): string {
  return speakerName ?? `Speaker ${speakerLabel}`;
}

export interface SpeakerColor {
  /** Classes for the speaker name chip: light background, dark text, border. */
  chip: string;
  /** Dark text color for secondary inline uses of the speaker color. */
  accent: string;
}

// Eight visually distinct combinations. All use dark text on a light tinted
// chip (WCAG AA+ contrast) — never white on a bright color.
const SPEAKER_PALETTE: readonly SpeakerColor[] = [
  { chip: "bg-sky-100 text-sky-950 border-sky-300", accent: "text-sky-800" },
  {
    chip: "bg-emerald-100 text-emerald-950 border-emerald-300",
    accent: "text-emerald-800",
  },
  {
    chip: "bg-amber-100 text-amber-950 border-amber-300",
    accent: "text-amber-800",
  },
  {
    chip: "bg-violet-100 text-violet-950 border-violet-300",
    accent: "text-violet-800",
  },
  { chip: "bg-rose-100 text-rose-950 border-rose-300", accent: "text-rose-800" },
  { chip: "bg-teal-100 text-teal-950 border-teal-300", accent: "text-teal-800" },
  {
    chip: "bg-indigo-100 text-indigo-950 border-indigo-300",
    accent: "text-indigo-800",
  },
  {
    chip: "bg-orange-100 text-orange-950 border-orange-300",
    accent: "text-orange-800",
  },
];

const DEFAULT_SPEAKER_COLOR: SpeakerColor = {
  chip: "bg-slate-100 text-slate-950 border-slate-300",
  accent: "text-slate-800",
};

/** Deterministic color per speaker label. "A".."H" map to 8 distinct colors. */
export function speakerColor(label: string): SpeakerColor {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length] ?? DEFAULT_SPEAKER_COLOR;
}

// Query tokenizing and stem-aware match detection live in the framework-free
// highlight module so they're unit-testable in a node env; re-exported here for
// the components and pages that import them from this file.
export { tokenize, matchesAllTokens } from "@/lib/text/highlight";

/**
 * Render text with every matching word wrapped in <mark>. A word matches when
 * it contains a query token as a substring or shares a stem with one, so
 * Postgres FTS stemming ("zoning" matching "zoned") is reflected in the
 * highlight (see highlightSegments). Safe for server and client rendering.
 */
export function HighlightedText({
  text,
  tokens,
}: {
  text: string;
  tokens: string[];
}): ReactElement {
  const segments = highlightSegments(text, tokens);
  return (
    <>
      {segments.map((segment, i) =>
        segment.marked ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200 px-0.5 text-slate-950"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}
