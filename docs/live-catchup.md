# CivicScribe live "catch me up" recap (design)

Status: approved 2026-06-16. Builds on docs/live-transcription.md. Ships
dormant + cheap (only generates while a live meeting actually has viewers).

## Goal

Anyone tuning into a live meeting on `/meetings/[id]/live` gets a "Here's what
you missed" plain-language recap of what has been covered so far, kept current
as the meeting proceeds.

## Approach (locked)

- ROLLING summary: keep ONE recap per meeting, updated by feeding
  [prior recap] + [only the new live_utterances since it last covered] to the
  LLM. Input stays bounded even on a multi-hour meeting.
- CACHED + SHARED: the recap is stored on the meeting and served to ALL viewers
  (never generated per-viewer).
- LAZY regeneration: the existing live poll endpoint refreshes the recap
  fire-and-forget (the same `void processOneJob()` pattern the Recall webhook
  uses) when it is stale (older than ~120s) AND the meeting is live (status
  capturing) AND there are new lines since it last covered. No one polling means
  no generation. The staleness gate bounds cost to <=1 LLM call per ~2 minutes
  per live meeting, regardless of audience size.
- PROVISIONAL: labeled auto-generated from the unreviewed live transcript, same
  caveat as the live captions. The post-meeting batch summary remains the
  authoritative record.

## Data model (migration 0013)

`meetings` gains: `live_summary text`, `live_summary_through_id bigint`,
`live_summary_at timestamptz` (all null by default). One rolling recap per
meeting; no new table.

## Backend

- `SummaryProvider` gains `catchUp(input)` -> a concise plain-language recap
  string (3-6 sentences, plain English, no jargon, covering discussion +
  decisions/votes so far). Real (Anthropic) + mock (deterministic) impls.
- `src/lib/live/catchup.ts`:
  - `REFRESH_INTERVAL_MS = 120_000`, `MAX_LINES` cap (~400) so the first
    generation on a long-running meeting is bounded.
  - `shouldRefreshCatchUp(meeting, latestUtteranceId, nowMs)`: pure + tested.
    True when status is capturing AND new lines exist (latestUtteranceId >
    live_summary_through_id) AND (live_summary_at is null OR older than the
    interval).
  - `maybeRefreshCatchUp(meeting, store, providers)`: if it should, optimistic
    debounce (write live_summary_at = now first to deter concurrent pollers),
    load the new lines since through_id (capped), call `catchUp(prior + new)`,
    persist {live_summary, live_summary_through_id = latest id, live_summary_at}.
    Best-effort; never throws.
- Live poll route (`GET /api/meetings/[id]/live`): include
  `catchUp: { text, updatedAt } | null` (from the meeting) in the response, and
  when phase === "live", fire-and-forget `maybeRefreshCatchUp` so the cache
  stays warm for the next poll.

## Frontend

- `LiveTranscript`: a "Here's what you missed" card above the transcript when a
  recap exists, showing the text + "updated X ago". Hidden when there is no
  recap and in popout mode (the popout stays minimal). Reads `catchUp` from the
  poll response, so it updates on the normal 2s cadence.

## Cost

~1 bounded LLM call per ~2 minutes per ACTIVE live meeting (not per viewer);
pennies per meeting; zero when nobody is watching.

## Tests

- `shouldRefreshCatchUp` gate: fresh -> skip, stale + new lines -> refresh,
  no new lines -> skip, not-capturing -> skip.
- `maybeRefreshCatchUp`: persists the recap, advances through_id to the latest
  line, calls the provider once, no-ops when not due.
- Poll route includes `catchUp`; mock `catchUp` is deterministic.
