-- Scheduled / recurring capture.
--
-- A schedule stores a source spec (resolved to a URL at fire time) + a
-- structured recurrence + a next_fire_at watermark. The scheduler sweep
-- (src/lib/jobs/scheduler.ts) materializes a meeting + capture job when a
-- schedule is due, then advances next_fire_at. meetings.schedule_id +
-- occurrence_key make firing idempotent across overlapping ticks.

create table schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body_name text not null,
  kind text not null default 'civic' check (kind in ('civic', 'course')),
  source_type text not null check (source_type in ('zoom', 'stream')),
  source_spec jsonb not null,
  recurrence jsonb not null,
  enabled boolean not null default true,
  next_fire_at timestamptz not null,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);

-- The sweep selects enabled schedules whose next_fire_at <= now().
create index schedules_due_idx on schedules (next_fire_at) where enabled;

alter table meetings
  add column schedule_id uuid references schedules (id) on delete set null,
  add column occurrence_key text;

-- One meeting per (schedule, occurrence): the hard idempotency backstop.
create unique index meetings_schedule_occurrence_idx
  on meetings (schedule_id, occurrence_key)
  where schedule_id is not null and occurrence_key is not null;

-- RLS: single-user v1, locked down for anon (service-role key bypasses).
alter table schedules enable row level security;
