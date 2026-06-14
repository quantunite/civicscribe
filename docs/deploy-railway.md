# Deploying CivicScribe to Railway

**One service.** `railway.json` sets the start command to `npm run start:railway`
(`scripts/railway-start.mjs`), which runs `next start` AND an in-process tick
loop in the same container, so a single service drives both the web app and the
job runner + schedule sweep. (`npm run worker` is still available if you ever
prefer a separate worker service, but it isn't needed.)

## Phase 1: mock demo (free, no API keys)

Proves the host + URL + schedules end-to-end. `MOCK_MODE=true` uses the
file-backed MemoryStore, so no Supabase or provider keys are needed. (The
container filesystem is ephemeral, so demo data resets on redeploy, as expected.)

- New Project → Deploy from GitHub repo → `quantunite/civicscribe`, branch `master`.
- Build + start come from `railway.json` (NIXPACKS build → `npm run build`;
  start → `npm run start:railway`). `next start` binds to Railway's `$PORT`.
- Variables:
  - `MOCK_MODE=true`
  - `DATA_DIR=/tmp/civicscribe` (writable on Railway)
- Deploy, then generate a public domain.

Smoke test: open the URL, add a meeting (Stream URL), watch it reach
**Complete** within ~30s; create a schedule and confirm it lists.

## Phase 2: go live (real transcription + summaries)

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
- `APP_BASE_URL=<web public URL>`: used for completion-email links, the OG /
  canonical `metadataBase`, and (when it is an https host) widening the CSP
  `img-src` / `media-src` so served audio loads.
- `TICK_SECRET=<a long random string>`: once set, `/api/jobs/tick` rejects
  unauthenticated callers. The single-service start command
  (`scripts/railway-start.mjs`) reads the same value and sends it as
  `Authorization: Bearer $TICK_SECRET`, so its in-process tick loop keeps
  authenticating. (If you instead run a separate worker service, set the SAME
  value there.)
- `OWNER_SECRET=<a long random string>`: REQUIRED before exposing the app. When
  unset the access layer is a complete no-op and everyone is treated as admin
  (fine for dev, unsafe public). It gates delete/manage, speaker edits,
  schedules, publish/unpublish, and the `/review` queue, and exempts admins from
  the guardrails below.
- Cost / abuse guardrails (public generation now spends real money). Admin is
  exempt from all three; defaults apply when unset:
  - `MAX_SUBMITS_PER_IP_PER_DAY` (default 20): per-IP daily submission cap.
  - `MAX_SUBMITS_GLOBAL_PER_DAY` (default 200): coarse global daily intake cap.
  - `MAX_UPLOAD_MB` (default 200): upload size cap in megabytes.
- Optional: `RECALL_API_KEY` (Zoom capture), `RESEND_API_KEY` + `NOTIFY_EMAIL`
  (completion emails), `RECALL_WEBHOOK_SECRET` (if you register a Recall webhook
  at `…/api/webhooks/recall?token=<secret>`).

A complete production env template lives at `.env.railway.example`.

Cost: ~$0.17/audio-hr (AssemblyAI) + ~$0.05/audio-hr (Anthropic).

### Ops + safety on the live deploy
- **`numReplicas` stays 1** (`railway.json`). Two in-process tick loops would
  double-claim and double-spend on every job. Do not scale the service out.
- **Healthcheck** hits `/api/health` (a cheap store read) with a 120s timeout
  (`railway.json`), so a deploy is not marked healthy until the data layer is
  reachable. The start script also waits for the local port to answer before the
  first tick fires, so the schedule sweep starts cleanly.
- **Security headers + CSP** are sent on every route (`next.config.ts` via
  `src/lib/http/security-headers.ts`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` + `frame-ancestors`, a
  self-by-default Content-Security-Policy, and a Permissions-Policy. Supabase,
  Anthropic, and AssemblyAI are all called server-side, so the browser needs no
  special `connect-src`.
- **Audio caching**: `/api/audio` sends `Cache-Control: public, max-age=86400,
  immutable` (the path embeds the immutable meeting id).

## Notes
- Production build uses webpack (`next build`), not Turbopack; the Turbopack
  build fails non-deterministically (see package.json / commit history).
- The schedule sweep runs on every tick, so a single worker (or any external
  cron hitting `/api/jobs/tick`) drives both job processing and scheduling.
