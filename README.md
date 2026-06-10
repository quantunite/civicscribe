# CivicScribe

Capture, transcribe, and summarize public meetings — built accessibility-first
for a hard-of-hearing user who can't always attend live.

Submit a meeting three ways:

- **Zoom URL** — a [Recall.ai](https://recall.ai) bot joins and records
- **Stream URL** — audio extracted with `yt-dlp`
- **Upload** — drop in an audio/video file

The pipeline transcribes with speaker diarization (AssemblyAI), generates a
structured summary (Anthropic API), and presents everything in a searchable
archive: summary panel, virtualized transcript with editable speaker names,
full-text search, and an audio player that seeks when you click a timestamp.

## 5-minute quickstart (MOCK_MODE — zero API keys)

Every external service sits behind a provider interface with a mock
implementation. `MOCK_MODE=true` (already set in `.env.local`) runs the entire
submit → process → view flow with no keys, no Docker, no network.

```bash
npm install
npm run seed     # two complete demo meetings (transcripts, summaries, audio)
npm run dev      # http://localhost:3000
```

In a second terminal:

```bash
npm run worker   # polls POST /api/jobs/tick every 5s
```

Now open http://localhost:3000 — the seeded meetings are browsable
immediately. Add one yourself: **Add meeting → Upload file** (any audio file),
or paste a Zoom/stream URL — in mock mode every path completes in a few
seconds and lands on a full transcript + summary.

### Verify

```bash
npm run typecheck
npm run lint
npm run test       # Vitest unit tests
npm run test:e2e   # Playwright: full mock pipeline through the real UI
```

## How it works

```
submit (web) ──> meetings + jobs (store) ──> worker tick ──> capture ─> transcribe ─> summarize ─> notify
                                                              Recall/    AssemblyAI    Anthropic    Resend
                                                              yt-dlp/
                                                              upload
```

- **Job queue**: a `jobs` table; `POST /api/jobs/tick` claims and processes one
  pending job per call (`SELECT … FOR UPDATE SKIP LOCKED` in Postgres). Max 3
  attempts, then the job and meeting are marked failed with the error surfaced
  in the UI.
- **Two data backends** behind one `DataStore` interface: a file-backed local
  store (mock mode, `.data/`) and Supabase (production, schema in
  `supabase/migrations/`). Full-text search is tsvector+GIN in Postgres.
- **Speaker aliases**: rename "Speaker A" once, apply to all their utterances,
  and the alias auto-applies to future meetings of the same body.

## Going live

Set `MOCK_MODE=false` in `.env.local` and fill in keys as you obtain them
(every variable is documented in `.env.example`). Each provider activates
independently — you can go live one service at a time.

1. **Supabase** (database + audio storage)
   - Create a project at [supabase.com](https://supabase.com) (or run locally:
     install Docker Desktop, then `supabase start`).
   - Apply the schema: `supabase db push` (or run
     `supabase/migrations/0001_init.sql` in the SQL editor).
   - Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

2. **AssemblyAI** (transcription + diarization) — sign up at
   [assemblyai.com](https://www.assemblyai.com), copy the API key →
   `ASSEMBLYAI_API_KEY`. Pay-as-you-go; this is the first key to get since
   uploads only need this one (plus Supabase).

3. **Anthropic** (summaries) — create a key at
   [platform.claude.com](https://platform.claude.com) → `ANTHROPIC_API_KEY`.
   Model defaults to `claude-sonnet-4-6` (override with `ANTHROPIC_MODEL`).

4. **Recall.ai** (Zoom capture) — **requires signup approval**; request access
   at [recall.ai](https://recall.ai), then set `RECALL_API_KEY` and
   `RECALL_REGION` (e.g. `us-west-2`). Until approved, Zoom capture will fail
   cleanly; uploads and streams work without it.

5. **yt-dlp** (stream capture) — install the binary and ensure it's on PATH
   (`winget install yt-dlp` on Windows, `brew install yt-dlp` on macOS), or
   set `YTDLP_PATH`.
   - **ffmpeg is required** for audio extraction — `yt-dlp -x` shells out to
     it (`winget install ffmpeg` on Windows, `brew install ffmpeg` on macOS).
   - Stream capture works for VOD and already-live streams; scheduled capture
     of future live streams is v2 (see the v2 list below).

6. **Resend** (email, optional) — set `RESEND_API_KEY` and `NOTIFY_EMAIL`.
   Without a key, completion emails are logged to the console (dev stub).

**What to test first when going live**: upload a short real audio file (this
exercises Supabase + AssemblyAI + Anthropic and nothing else), watch the
worker logs, and confirm the transcript has real speaker labels. Then try a
stream URL (adds yt-dlp), and a Zoom meeting last (needs Recall approval).

## v2 (explicit non-goals for v1)

- Real-time live captions
- Playwright-based capture of obscure municipal video players
- Twilio dial-in capture
- Scheduled automatic capture of recurring meetings (live-stream scheduling is
  documented as a limitation: yt-dlp handles already-live or VOD content)
- Multi-user auth (v1 is single-user; Supabase RLS kept simple)
- Speaker voice enrollment

## Repo map

| Path | What |
|---|---|
| `src/lib/types.ts` | Domain types |
| `src/lib/providers/` | Provider interfaces + `real/` + `mock/` implementations |
| `src/lib/store/` | `DataStore`/`FileStorage` contracts, memory + Supabase impls |
| `src/lib/jobs/` | Job runner + pipeline stages |
| `src/lib/fixtures/` | Fixture council/planning transcripts + WAV synth |
| `src/app/` | Pages + API routes (App Router) |
| `scripts/` | `worker.ts` (tick poller), `seed.ts` (demo data) |
| `supabase/migrations/` | Postgres schema (FTS, job queue, `claim_next_job()`) |
| `DECISIONS.md` | Judgment calls made during the build |
| `FINAL_REPORT.md` | Build wrap-up: what exists, limitations, mock→live checklist |
