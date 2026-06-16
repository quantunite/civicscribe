# CivicScribe Live Transcription (design)

Status: approved 2026-06-16. Ships default-off (dormant until a meeting opts in).

## Goal

Let anyone follow a real-time transcript of a meeting CivicScribe is capturing,
alongside their own meeting window, including a popout window. This is most
valuable for meetings whose platform has no captions: the bot CivicScribe
already sends into the meeting provides the captions everyone can read live.

## Decisions (locked with Amel)

- Transcription engine: Recall.ai built-in real-time transcription. Same
  $0.15 per recording-hour as the batch pass, no extra infrastructure, and it
  avoids AssemblyAI streaming's session-duration billing.
- Browser delivery: lightweight POLLING (v1). The live page polls
  GET /api/meetings/[id]/live?since=<id> every ~2s. Finalized utterances arrive
  every few seconds, so polling is timely, works identically in mock and prod
  (no RLS/anon-key/publication setup), and sidesteps the postgres_changes
  scaling caveat. Supabase Realtime is a documented future optimization.
- Opt-in per meeting, default off. Bot sources only (zoom, teams, meet);
  stream and upload sources cannot go live and the toggle is disabled there.
- Two surfaces, two gates:
  - Live now (in progress): public, auto-listed with a live badge plus a
    shareable link. No staff approval.
  - Permanent library (after the meeting ends): unchanged. The meeting enters
    the existing review queue and only appears in the public library after
    staff approve and publish it.
- The live transcript is provisional. After the meeting, the clean diarized
  batch transcript becomes the authoritative archived record (batch replaces
  live).
- A popout window is included.

## Lifecycle

1. Opt in when adding or scheduling a bot meeting (Live captions checkbox).
2. Bot joins and starts recording. The meeting appears under Live now and the
   live URL works. Public, no approval.
3. Meeting ends. It drops off Live now and runs the normal pipeline
   (transcribe, summarize) and enters the review queue.
4. Staff publish. It appears in the permanent library; the live URL then
   resolves to the published meeting page.

## Architecture and data flow

```
Recall bot (live on) --real-time transcript--> /api/webhooks/recall
        |                                              | insert finalized lines
        +-- records full MP3 (unchanged) --> batch     v
                                              live_utterances (Memory/Supabase)
                                                        ^ GET .../live?since=<id>
                                                        | (poll ~2s)
                              /meetings/[id]/live  +  popout window
```

- The real-time path is webhook-driven and independent of the tick/poll job
  runner, so it fits the serverless model.
- The existing capture -> transcribe -> summarize -> notify batch pipeline is
  untouched and still produces the archived transcript.

## Data model

- `meetings.live_enabled boolean not null default false`, plus
  `live_started_at` and `live_ended_at timestamptz null`.
- `schedules.live_enabled boolean not null default false` (created meetings
  inherit it).
- New `live_utterances`: id (bigserial cursor), meeting_id (fk, cascade),
  speaker_label text null, text text, ts_seconds double precision, created_at.
  Index on (meeting_id, id). We ingest only finalized `transcript.data`, so
  there is no seq / is_final. RLS enabled with no public policy (the app
  reads/writes via the service-role client; the public poll endpoint serves it).

## Backend

- Capture stage: when `meeting.live_enabled`, `createBot` includes Recall
  real-time transcription config delivering transcript events to the webhook.
  (Exact config + event payload per Recall real-time transcription docs.)
- Webhook `/api/webhooks/recall`: handle `transcript.data` events; map
  `data.bot.metadata.civicscribe_meeting_id` to the meeting; append finalized
  lines to `live_utterances` (only when the meeting is live_enabled); set
  `live_started_at` on the first line. `live_ended_at` is set when capture
  completes. Never throws; always returns 200.
- Security: in real (non-mock) mode the webhook REQUIRES `RECALL_WEBHOOK_SECRET`
  (503 otherwise), and the bot's webhook URL carries it as `?token=`. This stops
  a forged `transcript.data` from injecting fake live lines (the meeting UUID is
  public in the live URL). It MUST be set before flipping `MOCK_MODE=false`.
- Retention: prune `live_utterances` after publish (or after N days).

## Frontend

- Opt-in: a Live captions checkbox on New Meeting, New Schedule, and Edit
  Schedule, enabled only for bot sources.
- Live now: a section on the home page and the library listing meetings where
  `live_enabled` and status is capturing, with a live badge.
- `/meetings/[id]/live`: large auto-scrolling transcript, speaker labels, a
  phase indicator (waiting / live / ended), Copy link and Pop out buttons;
  responsive so it can sit beside a meeting window. `?popout=1` renders minimal
  chrome. The poll returns a tri-state `phase`: the client keeps polling while
  "waiting" (bot not joined yet) AND "live", and stops only on "ended", so
  opening the page early never shows a false "Ended".
- Access: public while live (and provisional after the meeting ends, until
  published); after publish it redirects to `/meetings/[id]`.

## Cost

About $0.15 per meeting-hour, only when live is toggled on. No monthly
minimums on Recall or the STT.

## Open / nice-to-have

- Interim partial-word display (the flickering in-progress line) vs finalized
  lines only. v1 ships finalized lines; partial line is a later enhancement.
- Exact live-line retention window.
- Live now empty state.

## Build phases

1. Schema + RLS + Realtime publication.
2. Capture: conditional real-time config on the bot.
3. Webhook: ingest transcript events into `live_utterances`.
4. Live page + popout (Realtime subscription).
5. Live now listing + opt-in toggles in the forms.
6. Lifecycle polish (end transition, publish redirect, retention pruning).

## Testing

- Unit: webhook parser maps fixture transcript events to utterances;
  idempotency; bot-to-meeting mapping; opt-in gating (stream/upload rejected);
  live-now listing filter; live page renders from mock utterances.
- MOCK_MODE simulates live utterances so the flow runs without a real bot.
- The real end-to-end (a bot streaming from a live meeting) is verified by
  Amel with an actual meeting.
