# CivicScribe — Decisions Log

Judgment calls made during the autonomous build, with reasons.

1. **Anthropic model: `claude-sonnet-4-6` instead of the pinned `claude-sonnet-4-20250514`.**
   The pinned model is deprecated and retires 2026-06-15. `claude-sonnet-4-6`
   is Anthropic's official drop-in replacement. Configurable via
   `ANTHROPIC_MODEL`.

2. **Data layer is also swappable (MemoryStore vs SupabaseStore).**
   The spec requires the entire app to run end-to-end in MOCK_MODE with zero
   API keys — which includes no Supabase keys — and this machine has no Docker,
   so the local Supabase stack cannot run here anyway. The store sits behind a
   `DataStore` interface: MOCK_MODE (or missing `SUPABASE_URL`) uses a
   file-backed JSON store under `.data/`; production uses Supabase with proper
   migrations in `supabase/migrations/`. Full-text search is Postgres
   tsvector+GIN in Supabase and a case-insensitive token match in the memory
   store.

3. **Audio storage follows the same split.** Local disk under `.data/storage/`
   in mock mode, Supabase Storage bucket `meeting-audio` otherwise. The browser
   always streams audio through `/api/audio/[...path]` so both backends look
   identical to the UI.

4. **Mock audio is synthesized WAV.** Mock capture/stream providers generate a
   short valid WAV (silence/tone) so the meeting page's audio player genuinely
   plays in mock mode without binary fixtures in the repo.

5. **Summary JSON via structured outputs + defensive parsing.** The Anthropic
   provider requests strict JSON with `output_config.format` (json_schema) —
   the current, guaranteed-valid mechanism — and still strips code fences and
   retries once on a parse failure, as specced, in case the model/config is
   overridden.

6. **Summaries' key_decisions / action_items / topics are string arrays**
   (jsonb arrays in Postgres). Plain strings keep the v1 UI and prompt schema
   simple; structured objects can be added later without a schema change since
   the columns are jsonb.

7. **Job retry semantics.** `failJob()` increments `attempts`; below
   MAX_JOB_ATTEMPTS (3) the job returns to `pending` for a later tick, at 3 it
   is marked `failed` and the meeting gets `status=failed` +
   `error_message` surfaced in the UI.

8. **Worker is a poller, processing happens in the web process.** `npm run
   worker` POSTs `/api/jobs/tick` every 5s as specced; the route claims and
   processes one job per invocation. This keeps a single code path for jobs in
   both dev and deployments with external cron.

9. **yt-dlp and Docker are not installed on this build machine.** The real
   stream provider shells out to `yt-dlp` and reports a clear error if the
   binary is missing; the README "going live" section covers installing it and
   Docker (for `supabase start`). Neither is needed in mock mode.

10. **Recall.ai integration is poll-based with a webhook accelerator.** The
    capture stage polls bot status on each tick; `/api/webhooks/recall` also
    accepts "recording ready" callbacks and enqueues immediate processing.
    Polling alone is sufficient for correctness.
