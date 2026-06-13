# Deploying CivicScribe

CivicScribe is a Next.js app **plus a background worker** that drains the job
queue (capture → transcribe → summarize → notify). Any hosting choice has to
account for both: a web service and a way to tick the queue.

This repo ships three ready-to-use paths. Pick one.

---

## Before you deploy: turn on auth

CivicScribe was designed as a single-user, no-auth personal archive. On a
public URL that means anyone could read your archive or submit meetings (which
spends your API credits). **Set a password before going live.**

| Variable      | Purpose                                                            |
| ------------- | ----------------------------------------------------------------- |
| `APP_PASSWORD`| Enables the login gate. Unset = auth disabled (local/dev only).    |
| `AUTH_SECRET` | Signs session cookies. Defaults to `APP_PASSWORD`; set your own.   |
| `CRON_SECRET` | Required header for `/api/jobs/tick`. The worker/cron must send it.|

Generate secrets with `openssl rand -hex 32`.

You'll also need a hosted **Supabase** project (URL + anon key + service-role
key) and provider keys (`ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY`, optionally
`RECALL_API_KEY`, `RESEND_API_KEY`). See `.env.example` for the full list. Run
the migration in `supabase/migrations/` against your project first.

---

## Option A — Render (recommended, blueprint included)

`render.yaml` defines a **web** service and a **worker** service that share the
`Dockerfile`.

1. Push this branch to GitHub.
2. In Render: **New → Blueprint**, select the repo. Render reads `render.yaml`.
3. Fill the `sync: false` secrets in the dashboard (`APP_PASSWORD`, Supabase,
   provider keys). `AUTH_SECRET` and `CRON_SECRET` are generated automatically
   and shared with the worker.
4. After the web service has a URL, set `APP_BASE_URL` on **both** services to
   that URL and redeploy the worker.

> Background workers require a paid Render plan. To stay cheaper, delete the
> worker service and add a **Render Cron Job** hitting `/api/jobs/tick` with the
> `CRON_SECRET` (see Option C for the cron shape).

## Option B — Railway / Fly.io / any Docker host

The `Dockerfile` runs the web app by default (`npm start`). Add a second
service/process from the same image with the command `npm run worker`.

- **Railway:** deploy the repo (it auto-detects the Dockerfile) for the web
  service, then add a second service from the same repo with the start command
  overridden to `npm run worker`. Set `APP_BASE_URL` to the web service's
  public domain and share `CRON_SECRET` across both.
- **Fly.io:** one app with two processes (`processes = { app = "npm start",
  worker = "npm run worker" }`) works the same way.

Set all env vars from `.env.example` on the host (never commit real secrets).

## Option C — Vercel + Cron (no always-on worker)

Vercel hosts the Next.js app natively; `vercel.json` registers a cron that hits
`/api/jobs/tick` every minute instead of running a worker process.

1. Import the repo into Vercel.
2. Add env vars (`APP_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, Supabase,
   provider keys). Set `APP_BASE_URL` to the deployed URL.
3. The tick route accepts `GET` and checks `Authorization: Bearer <CRON_SECRET>`
   — which Vercel Cron sends automatically when `CRON_SECRET` is set.

Trade-off: the cron's minimum cadence is 1 minute (vs. the worker's 5s), which
is fine for a personal archive since processing takes minutes anyway.

---

## Verifying a deployment

- `GET /api/health` → `{"status":"ok"}` (never gated by auth).
- Visit the site → you should be redirected to `/login`.
- After signing in, submit a meeting and confirm the status advances (the
  worker/cron is ticking).
- `curl -X POST https://<app>/api/jobs/tick` **without** the secret → `401`.
