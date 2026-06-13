import type { UtteranceSearchResult } from "@/lib/types";

/**
 * Order utterance search hits newest-meeting-first, then by meeting id, then by
 * within-meeting start_ms. Returns a new array; does not mutate the input.
 *
 * Both stores apply this AFTER collecting matches and BEFORE slicing to the
 * limit, so the limit keeps the newest meetings' hits. (Bug 2 was SupabaseStore
 * applying its DB LIMIT to a start_ms-ordered fetch before this sort, dropping
 * newer meetings; the SupabaseStore RPC now orders by meeting recency in SQL so
 * the fetched window and this final order agree.)
 */
export function orderSearchResults(
  results: UtteranceSearchResult[]
): UtteranceSearchResult[] {
  return [...results].sort(
    (a, b) =>
      b.meeting.created_at.localeCompare(a.meeting.created_at) ||
      a.meeting.id.localeCompare(b.meeting.id) ||
      a.utterance.start_ms - b.utterance.start_ms
  );
}
