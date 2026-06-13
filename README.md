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

### Keys at a glance — what each submission path needs

| To go live with… | Required | Why |
|---|---|---|
| **Upload file** | `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY` — plus the three `SUPABASE_*` keys, or skip them to keep the local file store | AssemblyAI turns audio into a diarized transcript; Anthropic writes the summary; Supabase stores meetings + audio in production |
| **Stream URL** | everything above, plus `yt-dlp` and `ffmpeg` installed (binaries, not keys) | yt-dlp downloads the stream; ffmpeg extracts the audio track |
| **Zoom URL** | everything above, plus `RECALL_API_KEY` + `RECALL_REGION` (**signup approval required — request early**) | a Recall.ai bot joins the meeting and records it |
| **Completion email** (optional) | `RESEND_API_KEY` + `NOTIFY_EMAIL` | without them, emails are logged to the console |

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

### What it costs to run

Usage-based pricing as of June 2026 — check the providers' pricing pages
before budgeting, these move around.

| Service | Rate | Notes |
|---|---|---|
| AssemblyAI | ~$0.17 / audio hr | $0.15 base + $0.02 diarization; announced +10% on in-region pricing from July 1, 2026 |
| Anthropic (claude-sonnet-4-6) | ~$0.05 / audio hr | ~13k transcript tokens/hr at $3/M input + a ~1.5k-token summary at $15/M output |
| Recall.ai (Zoom only) | $0.50 / recording hr | pay-as-you-go; CivicScribe uses AssemblyAI for transcription, so Recall's own transcription add-on is not needed |
| yt-dlp / ffmpeg | $0 | open source |
| Resend | $0 | free tier covers 3,000 emails/month |

**Per typical 2-hour meeting:** ~$0.45 via upload or stream URL; ~$1.45 via
Zoom bot (the Recall hour rate is the difference).

**Monthly, realistically:**

- Light (a few uploaded recordings): ~$2/month
- Typical (~10 two-hour meetings, half via Zoom): **$8–10/month**
- Heavy (15 two-hour meetings, all Zoom): ~$22/month

**Fixed costs are the swing factor:**

- **Supabase**: free tier to start; its 1 GB storage holds roughly 30 hours of
  compressed meeting audio, after which Pro is $25/month. Defer it by staying
  on the local file store, or by pruning audio after transcription — the
  transcript and summary are tiny.
- **Hosting**: $0 while it runs on your own machine; a small always-on VPS is
  ~$5/month.

The Anthropic line is nearly negligible — a summary costs about a dime per
meeting. Transcription minutes dominate; Zoom bot hours double the marginal
cost when used.

### Hosting it somewhere

Ready-to-use deploy config is included — **[docs/DEPLOY.md](docs/DEPLOY.md)**
covers Render (blueprint in `render.yaml`), Railway/Fly/any Docker host
(`Dockerfile`), and Vercel + cron (`vercel.json`).

Because v1 has no per-user auth, a public deployment needs a gate so strangers
can't read your archive or spend your API credits. Set **`APP_PASSWORD`** to
turn on a single shared-password login (and `CRON_SECRET` to protect the job
tick endpoint). Both are unset — and therefore off — in local/mock mode, so
nothing changes for development.

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
