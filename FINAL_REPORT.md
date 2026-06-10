# CivicScribe — Final Report

v1 of the public-meeting capture/transcription/summary service specified in
`docs/civic-transcriber-claude-code-prompt.md`. Built autonomously; every
quality-bar check passes.

## What was built

**Product**: submit a meeting as a Zoom URL (Recall.ai bot), public stream URL
(yt-dlp), or direct upload → capture audio → transcribe with speaker
diarization (AssemblyAI) → structured summary (Anthropic) → searchable web
archive, with email notification (Resend, stubbed in dev).

**Stack** (as specced): Next.js 15 App Router, TypeScript strict, Tailwind v4,
Supabase (Postgres/storage; migrations in `supabase/migrations/`), AssemblyAI
behind a swappable `TranscriptionProvider`, Anthropic API, Recall.ai REST,
yt-dlp subprocess, Resend stub.

**MOCK_MODE** (the critical requirement): `MOCK_MODE=true` swaps every
provider for a mock and the data layer for a local file-backed store — the
entire submit→process→view flow runs with zero API keys, zero Docker, zero
network. Mock transcription returns a 52-utterance fixture city-council
meeting (4 speakers, zoning vote, budget item, public comment); mock capture
synthesizes a real playable WAV.

**Pipeline**: `jobs` table + `POST /api/jobs/tick` claims one job per call
(`FOR UPDATE SKIP LOCKED` via `claim_next_job()` in Postgres; mutex-serialized
claim in the local store). Chain: capture → transcribe → summarize → notify.
Max 3 attempts; failures surface on the meeting card. `npm run worker` polls
every 5s. Hardened post-review with: resumable Zoom capture (bot id persisted
in job payload; still-recording bots requeue without consuming attempts), a
45-minute lease reaper that recovers jobs orphaned by crashed workers, a
reconcile pass that fails stranded meetings, and idempotent transcribe
(transcript replace semantics).

**Frontend** (accessibility-first: 18px+ transcript type, strong contrast,
keyboard navigation, visible focus, semantic landmarks):
- `/` dashboard — status-badged cards, live 3s polling while processing
- `/meetings/new` — three-tab form (Zoom / Stream / Upload), client+server validation
- `/meetings/[id]` — summary panel (overview/decisions/actions/topics),
  virtualized transcript with per-speaker colors, inline speaker rename with
  apply-to-all + persistent aliases (auto-applied to future meetings of the
  same body), sticky filter-with-highlight search, bottom-pinned audio player
  with timestamp seeking, deep-link scroll targets
- `/search` — global FTS grouped by meeting with deep links

## Verification (all run, all passing)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run test` | 49/49 unit tests (queue/retry, AssemblyAI mapping, summary parse+retry, aliases, search, fixtures) |
| `npm run test:e2e` | full mock pipeline through the real UI: upload → process → transcript → rename → search |
| `npm run build` | production build clean |
| Manual | zoom + upload paths through the live worker; alias reuse across meetings; audio Range/206 + nosniff; SSRF guard 400s internal hosts; external db.json writes visible live |

An adversarial multi-agent review (correctness, security, spec-compliance
lenses; every finding independently verified against the code) confirmed 27
issues — all fixed except items explicitly accepted below. Highlights fixed:
Zoom capture couldn't survive meetings >20 min and spawned duplicate bots on
retry; crashed workers left meetings spinning forever; upload content-type
spoofing → stored-XSS vector; SSRF via stream URLs; yt-dlp arg injection;
unbounded upload buffering.

## Decisions

Full log with reasons in `DECISIONS.md` (18 entries). The load-bearing ones:
1. `claude-sonnet-4-6` replaces the spec's pinned `claude-sonnet-4-20250514`
   (deprecated, retires 2026-06-15); `ANTHROPIC_MODEL` overrides.
2. The data layer is swappable like the providers (file-backed store in mock
   mode) because the spec requires keyless end-to-end operation and the build
   machine has no Docker for local Supabase.
3. Uploads route through `POST /api/upload` rather than direct-to-Supabase
   (works identically in both modes; direct upload is a production
   optimization for v2).
4. Summary generation uses structured outputs (`output_config.format`) plus
   the specced defensive parse + single retry.
5. Job durability: lease reaper + requeue-without-attempt for long-running
   external work, rather than long in-tick polling.

## Known limitations

- Postgres FTS stemming can match words the literal highlighter doesn't mark
  (search finds "zoned" for "zoning"; the `<mark>` highlight may skip it).
- Supabase search applies its LIMIT to the DB fetch window before recency
  sorting (deterministic, but >limit matches may omit newer meetings).
- `/api/jobs/tick` and `/api/webhooks/recall` are unauthenticated —
  acceptable for a single-user deployment; add a shared secret before
  exposing publicly.
- Audio serving buffers whole objects in memory (no streaming); uploads cap
  at 512 MB (`MAX_UPLOAD_MB`).
- Live-stream capture handles already-live/VOD content; scheduled future
  capture is v2. yt-dlp needs ffmpeg installed.
- The local store is single-process-writer by design; concurrent writers are
  last-write-wins (Supabase is the multi-process backend).
- Build-process note: per-milestone commits (6) rather than per-file commits;
  granularity documented in git history.

## Exact commands

```bash
npm install
npm run seed       # two demo meetings
npm run dev        # http://localhost:3000
npm run worker     # second terminal: job processor
npm run typecheck && npm run lint && npm run test && npm run test:e2e
```

## Mock → live, in order

1. Create a Supabase project → set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`; apply `supabase/migrations/0001_init.sql`
   (`supabase db push`).
2. Get an AssemblyAI key → `ASSEMBLYAI_API_KEY`.
3. Get an Anthropic key → `ANTHROPIC_API_KEY`.
4. Set `MOCK_MODE=false`; restart. **Test: upload a short real audio file** —
   exercises storage + transcription + summary and nothing else.
5. Install `yt-dlp` + `ffmpeg`; test a public stream/VOD URL.
6. Request Recall.ai access (approval required) → `RECALL_API_KEY`,
   `RECALL_REGION`; test a Zoom meeting last.
7. Optional: `RESEND_API_KEY` + `NOTIFY_EMAIL` for completion emails.

Ends on a clean commit. STATUS.md tracks milestone state; README.md has the
user-facing quickstart and going-live guide.
