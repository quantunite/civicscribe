// Topic slugs for the public /tags/[slug] browse surface (Phase 2).
//
// Summaries carry a free-text `topics: string[]`. To browse the library by
// topic we turn each topic into a stable, URL-safe slug. The mapping is lossy
// (case + punctuation collapse) so that the many phrasings of one topic
// ("Public Safety", "public-safety", "PUBLIC  SAFETY") share a single slug and
// therefore a single /tags page.
//
// Because the slug is lossy, there is no exact reverse. topicMatchesSlug is the
// reverse-tolerant match instead: a slug "matches" any topic that re-slugifies
// to it. Both stores recover a slug's meetings by testing each summary topic
// with topicMatchesSlug, which keeps MemoryStore and SupabaseStore identical.

/** Slugify a free-text topic into a URL-safe slug: lowercase, non-alphanumeric
 *  runs collapsed to a single hyphen, leading/trailing hyphens trimmed.
 *  Returns "" for a topic with no slug-able characters (callers skip those). */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Routine procedural / administrative agenda items carry no subject matter:
// nobody browses or searches for "roll call", so they are dropped from the
// topic cloud, the per-meeting Topic chips, and tag browse. The summarizer
// prompt is also told to omit them (see real/anthropic.ts); this is the
// deterministic backstop that ALSO cleans summaries written before that
// instruction, with no LLM re-run.

/** Single ambiguous procedural words matched by EXACT slug only — never as a
 *  substring — so a real topic that merely contains the word is kept:
 *  "agenda for downtown rezoning" -> "agenda-for-downtown-rezoning" is NOT
 *  "agenda", and "10 minute comment limit" is NOT "minutes". */
const PROCEDURAL_EXACT_SLUGS: ReadonlySet<string> = new Set([
  "attendance",
  "quorum",
  "adjournment",
  "adjourn",
  "recess",
  "minutes",
  "meeting-minutes",
  "agenda",
  "consent-agenda",
  "pledge",
  "invocation",
  "old-business",
  "new-business",
  "unfinished-business",
  "announcements",
  "public-comment",
  "public-comments",
  "public-comment-period",
  "open-forum",
  "next-meeting",
  "future-meetings",
]);

/** Distinctive multi-word procedural phrases matched as a whole hyphen-delimited
 *  segment run, so variants are caught regardless of surrounding words:
 *  "roll-call-and-attendance" and "meeting-minutes-approval" both match. These
 *  phrases never occur inside a real subject-matter topic, so segment-bounded
 *  containment is safe (unlike the single words above). */
const PROCEDURAL_PHRASES: readonly string[] = [
  "roll-call",
  "call-to-order",
  "call-to-the-public",
  "pledge-of-allegiance",
  "moment-of-silence",
  "meeting-minutes",
  "minutes-approval",
  "approval-of-minutes",
  "approval-of-the-minutes",
  "approval-of-agenda",
  "approval-of-the-agenda",
  "adoption-of-the-agenda",
];

/** Whether a slug is a routine procedural item (exact ambiguous word, or a
 *  segment-bounded procedural phrase anywhere in the slug). */
function isProceduralSlug(slug: string): boolean {
  if (PROCEDURAL_EXACT_SLUGS.has(slug)) return true;
  // Pad with hyphens so a phrase only matches whole segments: "-roll-call-"
  // matches "roll-call-and-attendance" but never a word it is a prefix of.
  const padded = `-${slug}-`;
  return PROCEDURAL_PHRASES.some((p) => padded.includes(`-${p}-`));
}

/** True when a topic is real subject matter: it has a slug AND is not a routine
 *  procedural/administrative item. The single predicate behind the topic cloud
 *  and the per-meeting Topic chips. */
export function isMeaningfulTopic(topic: string): boolean {
  const slug = topicSlug(topic);
  return slug !== "" && !isProceduralSlug(slug);
}

/** Keep only meaningful (non-procedural, slug-able) topics; order preserved. */
export function filterMeaningfulTopics(topics: string[]): string[] {
  return topics.filter(isMeaningfulTopic);
}

/** True when `topic` belongs to the bucket identified by `slug` — i.e. the
 *  topic re-slugifies to that slug AND is meaningful. An empty or procedural
 *  slug never matches, so those have no browse page. */
export function topicMatchesSlug(topic: string, slug: string): boolean {
  const s = topicSlug(topic);
  return s !== "" && s === slug && !isProceduralSlug(s);
}

// ---------------------------------------------------------------------------
// Pure aggregation shared by MemoryStore and SupabaseStore, so the public
// /tags surface is byte-for-byte identical regardless of backend. Each store
// only has to fetch { the published meeting's id, its summary topics } and hand
// it here.

import type { TopicSummary } from "@/lib/types";

/**
 * Aggregate summary topics from PUBLISHED meetings into { topic, slug, count }
 * buckets. Topics that slugify identically collapse into one bucket; `topic` is
 * the most common raw spelling (alphabetical tiebreak), and `count` is the
 * number of DISTINCT meetings in the bucket (a meeting listing two spellings of
 * one slug counts once). Ordered count desc, then topic asc.
 *
 * Callers MUST pass only published meetings' summaries; the published filter
 * lives in the store query, not here.
 */
export function aggregateTopics(
  rows: Array<{ meetingId: string; topics: string[] }>
): TopicSummary[] {
  const buckets = new Map<
    string,
    { meetingIds: Set<string>; spellings: Map<string, number> }
  >();

  for (const row of rows) {
    for (const raw of row.topics) {
      // Skip unslug-able topics (no browse page) AND routine procedural items
      // (roll call, minutes, adjournment, …) that are not real subject matter.
      if (!isMeaningfulTopic(raw)) continue;
      const slug = topicSlug(raw);
      let bucket = buckets.get(slug);
      if (!bucket) {
        bucket = { meetingIds: new Set(), spellings: new Map() };
        buckets.set(slug, bucket);
      }
      bucket.meetingIds.add(row.meetingId);
      bucket.spellings.set(raw, (bucket.spellings.get(raw) ?? 0) + 1);
    }
  }

  const out: TopicSummary[] = [];
  for (const [slug, bucket] of buckets) {
    let topic = "";
    let best = -1;
    for (const [spelling, n] of bucket.spellings) {
      if (n > best || (n === best && spelling < topic)) {
        best = n;
        topic = spelling;
      }
    }
    out.push({ topic, slug, count: bucket.meetingIds.size });
  }

  out.sort(
    (a, b) =>
      b.count - a.count || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0)
  );
  return out;
}
