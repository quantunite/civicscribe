# Deploying CivicScribe to Railway

**One service.** `railway.json` sets the start command to `npm run start:railway`
(`scripts/railway-start.mjs`), which runs `next start` AND an in-process tick
loop in the same container — so a single service drives both the web app and the
job runner + schedule sweep. (`npm run worker` is still available if you ever
prefer a separate worker service, but it isn't needed.)

## Phase 1 — mock demo (free, no API keys)

Proves the host + URL + schedules end-to-end. `MOCK_MODE=true` uses the
file-backed MemoryStore, so no Supabase or provider keys are needed. (The
container filesystem is ephemeral, so demo data resets on redeploy — expected.)

- New Project → Deploy from GitHub repo → `quantunite/civicscribe`, branch `master`.
- Build + start come from `railway.json` (NIXPACKS build → `npm run build`;
  start → `npm run start:railway`). `next start` binds to Railway's `$PORT`.
- Variables:
  - `MOCK_MODE=true`
  - `DATA_DIR=/tmp/civicscribe` (writable on Railway)
- Deploy, then generate a public domain.

Smoke test: open the URL, add a meeting (Stream URL), watch it reach
**Complete** within ~30s; create a schedule and confirm it lists.

## Phase 2 — go live (real transcription + summaries)

Flip the web service to real providers and the dedicated Supabase project.

> **Already provisioned** (2026-06-13): Supabase project `civicscribe`, ref
> `qohvolrzcijqcfapryee`, URL `https://qohvolrzcijqcfapryee.supabase.co`.
> Migrations 0001–0005 are applied and the private `meeting-audio` bucket
> exists. Grab `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from the
> dashboard (Project Settings → API).

Add to the **web** service variables:
- `MOCK_MODE=false`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from the
  `civicscribe` Supabase project; migrations 0001–0005 already applied)
- `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY`
- `APP_BASE_URL=<web public URL>` (used in completion-email links)
- `TICK_SECRET=<a long random string>` — once set, `/api/jobs/tick` rejects
  unauthenticated callers. **Set the SAME value on the worker service** so it
  keeps authenticating (it sends `Authorization: Bearer $TICK_SECRET`).
- Optional: `RECALL_API_KEY` (Zoom capture), `RESEND_API_KEY` + `NOTIFY_EMAIL`
  (completion emails), `RECALL_WEBHOOK_SECRET` (if you register a Recall webhook
  at `…/api/webhooks/recall?token=<secret>`).

Cost: ~$0.17/audio-hr (AssemblyAI) + ~$0.05/audio-hr (Anthropic).

## Notes
- Production build uses webpack (`next build`), not Turbopack — the Turbopack
  build fails non-deterministically (see package.json / commit history).
- The schedule sweep runs on every tick, so a single worker (or any external
  cron hitting `/api/jobs/tick`) drives both job processing and scheduling.
