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

/** True when `topic` belongs to the bucket identified by `slug` — i.e. the
 *  topic re-slugifies to that slug. An empty slug never matches (an
 *  unslug-able topic has no browse page). */
export function topicMatchesSlug(topic: string, slug: string): boolean {
  const s = topicSlug(topic);
  return s !== "" && s === slug;
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
      const slug = topicSlug(raw);
      if (slug === "") continue; // unslug-able topic has no browse page
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
