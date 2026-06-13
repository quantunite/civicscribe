# Scheduled / Recurring Capture — Design

Date: 2026-06-13
Status: approved
Branch: `feat/v2-production-readiness`

This is the one net-new feature in the v2 production-readiness push. (The two
search-bug fixes and the deploy-hardening work are map-driven fixes tracked
separately; a short note on them is at the bottom.)

## Goal

Auto-capture recurring civic meetings (and educational/course videos) on a
cadence, so the corpus fills itself. This is what feeds the eventual browsable,
referenceable **library** north-star: scheduling is the intake, the library is
the read surface.

Today capture is on-demand only: a user creates a meeting and a `capture` job is
enqueued immediately. `meetings.scheduled_at` exists in the schema but is dormant
(written by `createMeeting`, never set by any caller, never read).

## Core abstraction: a schedule points at a *source*, not a URL

The meetings we want to capture expose video inconsistently (stable recurring
URL, a fresh URL per occurrence, or a channel/playlist). So a schedule stores a
**source spec** that resolves to a concrete capture URL *at fire time*:

- v1 ships one resolver: `{ type: "fixed_url", url }` — covers stable recurring
  stream URLs and recurring Zoom links.
- The resolver *interface* leaves room for `{ type: "youtube_channel", ... }` /
  playlist resolvers later (the "new URL per occurrence under a stable channel"
  case) without a schema change to the rest.

This is deliberately YAGNI: we do not build a channel scraper now, but nothing
walls it off.

## Data model — migration `0004_schedules.sql`

New `schedules` table:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | e.g. "City Council Regular Meeting" |
| `body_name` | text | |
| `kind` | text `civic`\|`course` default `civic` | scheduled crash-course captures work too |
| `source_type` | text `zoom`\|`stream` | upload cannot be scheduled |
| `source_spec` | jsonb | resolver input; v1 `{type:"fixed_url",url}` |
| `recurrence` | jsonb | structured cadence (below) |
| `enabled` | boolean default true | |
| `next_fire_at` | timestamptz | sweep watermark; the scheduler selects `enabled and next_fire_at <= now()` |
| `last_fired_at` | timestamptz null | |
| `created_at` | timestamptz default now() | |

Index: `(enabled, next_fire_at)` for the sweep query.

**Idempotency:** add `meetings.schedule_id uuid null` (FK → schedules, ON DELETE
SET NULL) and `meetings.occurrence_key text null`, with a partial
`unique(schedule_id, occurrence_key) where schedule_id is not null`. A fire that
double-runs cannot create a duplicate meeting for the same occurrence.

### Recurrence representation

Structured cadence, not cron/RRULE:

```jsonc
{
  "freq": "weekly" | "monthly",   // monthly = nth-weekday-of-month
  "interval": 1,                   // every N weeks (weekly only); default 1
  "weekday": 2,                    // 0=Sun..6=Sat
  "nth": 2,                        // monthly only: 2 = "2nd <weekday>"; -1 = last
  "time": "18:00",                 // local wall-clock time
  "timezone": "America/Chicago"    // IANA tz
}
```

Covers civic cadences including "2nd Tuesday of the month, 6pm CT", which a plain
interval can't express. Next-fire computation is DST-correct via **luxon** (pure
JS — safe on this locked-down Windows/Sophos box; the native-module concern does
not apply). Rejected `rrule` as more than civic cadences need.

## Scheduler — host-agnostic sweep

New `src/lib/jobs/scheduler.ts`:

```
sweepSchedules(store, providers, now) -> { fired: ScheduleFireResult[] }
```

For each `enabled && next_fire_at <= now`:
1. Resolve `source_spec` → concrete URL (resolver registry; v1 `fixed_url`).
2. Compute `occurrence_key` from the fired `next_fire_at` (e.g. ISO of the
   occurrence instant) — the idempotency key.
3. **Materialize at fire time:** `createAndEnqueueCapture()` — create the meeting
   row (with `schedule_id` + `occurrence_key`) and enqueue a `capture` job. This
   reuses the exact create+enqueue path the on-demand API uses (extracted into a
   shared helper from `POST /api/meetings`).
4. Advance `next_fire_at` to the next occurrence; set `last_fired_at`.

**Why materialize-at-fire-time** (not pre-insert a job with a time gate):
`claim_next_job()` stays untouched (no `scheduled_for <= now()` gate), and the
orphan-reaper in `reconcileMeetings` never sees a long-lived "scheduled but
uncaptured" meeting — so we need **no new `MeetingStatus`**. Upcoming runs live on
the schedule's `next_fire_at`, surfaced on the Schedules page, not as meeting rows.

**Invocation:** the sweep runs on the **same tick** as the job runner. The tick
route calls a new `processTick()` = `sweepSchedules()` then `processOneJob()`. So
whether the tick is driven by the persistent worker (`scripts/worker.ts`) or an
external cron in production, scheduling just works. Host choice is a deploy-time
decision, not a design dependency.

## Not-yet-live streams (pragmatic v1)

Firing runs the existing, tested capture pipeline (caption fast-lane → yt-dlp
audio). For `stream` sources add a bounded `--wait-for-video` and a
max-capture-duration cap so a late-starting or open-ended live stream is handled
and can't run forever. No VOD-offset machinery: the usage tip is to set the fire
time *after* the meeting to grab the posted VOD + captions (more robust and
cheaper than live audio). Configurable caps live in `config.ts`.

## UI

New **`/schedules`** section: list (title, body, cadence summary, next run, last
run, enabled toggle) + create / edit / delete. The create form reuses
`NewMeetingForm`'s source fields plus recurrence inputs. Nav link "Schedules".
The existing new-meeting form is untouched (one-off captures unchanged).

## Store contract

`DataStore` gains schedules CRUD + the sweep selector:
`createSchedule`, `listSchedules`, `getSchedule`, `updateSchedule`,
`deleteSchedule`, `claimDueSchedules(now)` (or `listDueSchedules` + per-fire
`updateSchedule`). Both `MemoryStore` and `SupabaseStore` implement them; mock
mode (MemoryStore) is the test backend.

## Testing (TDD)

Pure unit tests, MemoryStore + fake timers:
- recurrence next-fire computation, including DST boundaries (spring-forward /
  fall-back in `America/Chicago`).
- `fixed_url` resolver.
- idempotency: same occurrence fired twice → one meeting.
- `sweepSchedules`: due → creates meeting + `capture` job + advances
  `next_fire_at`; not-due → nothing; disabled → nothing.

e2e (mock mode): create a schedule with a past `next_fire_at` → tick → assert a
meeting was created and `driveToComplete` drives it to `complete`.

## Out of scope (v2+)

- Channel/playlist resolvers (interface only in v1).
- Live-stream "is it live yet?" detection beyond `--wait-for-video`.
- The public library read surface itself (kept unblocked: meetings remain the
  browsable unit; `schedule_id` records provenance).

---

## Companion fixes in this branch (map-driven, not part of this feature)

- **Search Bug 1 (highlight):** `transcript-utils.tsx` highlights from the literal
  query token, but Postgres FTS stems (`zoning`→`zoned`), so a matched row shows
  no `<mark>`. Fix in the highlighter so it marks what FTS matched. Supabase-only
  (MemoryStore substring-matches, so it already agrees).
- **Search Bug 2 (ordering):** `supabase.ts` applies `.limit()` on a
  `start_ms`-ordered fetch *before* the JS recency sort, dropping newest meetings
  when matches exceed the limit. Fix: order by `meeting.created_at DESC` before
  the limit; extract a pure recency-order-then-limit function used by both stores
  and unit-test it (MemoryStore as oracle).
- **Hardening:** timing-safe bearer secret on `/api/jobs/tick` (optional when
  unset so dev still boots; worker sends the header); shared-secret bearer on the
  Recall webhook (interim — it's only an accelerator, no endpoint registered;
  Svix later); true ranged streaming for audio via a `getRange()` storage
  contract (Supabase → signed-URL redirect). New secrets read via `config.ts`.
