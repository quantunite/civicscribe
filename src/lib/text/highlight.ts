// Search-query tokenizing and stem-aware match highlighting. No "use client"
// directive and no React: pure functions usable from server components, client
// components, and tests (node env). HighlightedText (transcript-utils.tsx) maps
// the segments to <mark>/<span>.

import stem from "wink-porter2-stemmer";

/** Lowercased whitespace-separated tokens of a search query. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when the text contains every token (case-insensitive). */
export function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

export interface HighlightSegment {
  text: string;
  marked: boolean;
}

// A run of letters/numbers is a "word"; everything else (spaces, punctuation)
// is passed through unmarked. The capturing group keeps the words in split().
const WORD_RUN = /([\p{L}\p{N}]+)/u;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split text into ordered segments, marking each word that matches any query
 * token. A word matches when it contains a token as a case-insensitive
 * substring (the literal behavior the old highlighter had) OR shares a stem
 * with a token, so Postgres FTS stemming — a query of "zoning" matching an
 * utterance that says "zoned" — is reflected in the highlight. Joining the
 * segment texts reconstructs the original text exactly.
 */
export function highlightSegments(
  text: string,
  tokens: string[]
): HighlightSegment[] {
  const cleaned = tokens.filter(Boolean).map((t) => t.toLowerCase());
  if (cleaned.length === 0) return [{ text, marked: false }];

  const tokenStems = new Set(cleaned.map((t) => stem(t)));
  const segments: HighlightSegment[] = [];

  for (const piece of text.split(WORD_RUN)) {
    if (piece === "") continue;
    const marked = HAS_WORD_CHAR.test(piece) && wordMatches(piece, cleaned, tokenStems);
    // Coalesce consecutive segments of the same marked-ness for tidy rendering.
    const last = segments[segments.length - 1];
    if (last && last.marked === marked) {
      last.text += piece;
    } else {
      segments.push({ text: piece, marked });
    }
  }

  return segments.length > 0 ? segments : [{ text, marked: false }];
}

function wordMatches(
  word: string,
  tokens: string[],
  tokenStems: Set<string>
): boolean {
  const lower = word.toLowerCase();
  if (tokens.some((t) => lower.includes(t))) return true;
  return tokenStems.has(stem(lower));
}
