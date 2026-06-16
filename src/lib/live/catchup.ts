// Live "catch me up" recap: a rolling, cached, shared recap of what a live
// meeting has covered so far. ONE recap per meeting (stored on the meeting and
// served to every viewer), refreshed lazily and fire-and-forget by the live
// poll endpoint at most ~once per 2 minutes per live meeting, only while someone
// is actually polling.
//
// ROLLING: each refresh feeds the prior recap plus ONLY the live_utterances
// added since it last covered, so the LLM input stays bounded on long meetings.
// Best-effort throughout: a failure must never break the live poll.

import type { Meeting } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";

/** Minimum gap between recap regenerations for one live meeting. Bounds cost to
 *  at most ~1 LLM call per 2 minutes per live meeting, regardless of audience. */
export const CATCHUP_REFRESH_INTERVAL_MS = 120_000;

/** Cap on lines fed to a single refresh so the first generation on a long
 *  meeting (no prior recap, many lines) stays bounded. The most recent lines
 *  matter most for "what you missed", so we take the tail. */
const MAX_LINES = 400;

/** The next contiguous window to summarize, and the cursor it covers through.
 *  When the uncovered backlog exceeds maxLines (e.g. a viewer opens a meeting
 *  that has been live a while, with no prior recap), take the OLDEST maxLines and
 *  advance the cursor only to that chunk, so the remaining lines are summarized on
 *  the next refresh and nothing is ever skipped (contiguous, no recap data loss).
 *  Callers must pass a non-empty, id-ascending list. */
export function nextRecapWindow<T extends { id: number }>(
  lines: T[],
  maxLines: number
): { window: T[]; coveredThroughId: number } {
  const window = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  return { window, coveredThroughId: window[window.length - 1].id };
}

/** In-process guard so concurrent pollers do not all generate at once. getStore()
 *  is a singleton in one Railway process and Node is single-threaded, so a
 *  synchronous has()+add() makes "one refresh per meeting at a time" exact within
 *  the process. The snapshot-based staleness gate alone cannot do this, because
 *  concurrent pollers share a pre-write snapshot and all pass it; the DB stamp in
 *  maybeRefreshCatchUp still covers the next interval and the rare multi-process
 *  case. */
const refreshing = new Set<string>();

/** Pure gate (testable): should we regenerate the recap right now? True iff the
 *  meeting is being captured, there are live lines the recap has not covered,
 *  and the recap is either missing or older than the refresh interval. */
export function shouldRefreshCatchUp(
  meeting: Meeting,
  latestUtteranceId: number,
  nowMs: number
): boolean {
  if (meeting.status !== "capturing") return false;
  if (latestUtteranceId <= (meeting.live_summary_through_id ?? 0)) return false;
  if (meeting.live_summary_at == null) return true;
  return nowMs - Date.parse(meeting.live_summary_at) > CATCHUP_REFRESH_INTERVAL_MS;
}

/** Best-effort rolling refresh of a live meeting's recap. NEVER throws: any
 *  failure (provider, store, parse) is swallowed so the live poll stays fast and
 *  reliable. Call it fire-and-forget from the poll endpoint. */
export async function maybeRefreshCatchUp(
  meeting: Meeting,
  store: DataStore,
  providers: Providers
): Promise<void> {
  try {
    // Only the lines the recap has not covered yet (the rolling window).
    const newLinesAll = await store.listLiveUtterances(
      meeting.id,
      meeting.live_summary_through_id ?? undefined
    );
    if (newLinesAll.length === 0) return;

    const latestId = newLinesAll[newLinesAll.length - 1].id;
    if (!shouldRefreshCatchUp(meeting, latestId, Date.now())) return;

    // Claim the slot in-process BEFORE any further await: has()+add() run to
    // completion atomically (single-threaded), so concurrent pollers sharing this
    // stale snapshot do not all generate. Exactly one wins per process.
    if (refreshing.has(meeting.id)) return;
    refreshing.add(meeting.id);
    try {
      // Optimistic debounce across the next interval (and the rare multi-process
      // case): stamp live_summary_at before the slow LLM call so a later poller's
      // snapshot reads fresh and skips at the gate above.
      await store.updateMeeting(meeting.id, {
        live_summary_at: new Date().toISOString(),
      });

      // Roll forward CONTIGUOUSLY: summarize the oldest uncovered chunk and
      // advance the cursor only to it, so a long backlog is covered chunk by chunk
      // across refreshes and nothing is ever skipped.
      const { window, coveredThroughId } = nextRecapWindow(newLinesAll, MAX_LINES);
      const newLines = window.map((line) => ({
        speaker: line.speaker_label ?? "Speaker",
        text: line.text,
      }));

      const text = await providers.summary.catchUp({
        meetingTitle: meeting.title,
        bodyName: meeting.body_name,
        priorSummary: meeting.live_summary,
        newLines,
      });

      await store.updateMeeting(meeting.id, {
        live_summary: text,
        live_summary_through_id: coveredThroughId,
        live_summary_at: new Date().toISOString(),
      });
    } finally {
      refreshing.delete(meeting.id);
    }
  } catch (err) {
    console.error("[live:catchup] refresh failed:", err);
  }
}
