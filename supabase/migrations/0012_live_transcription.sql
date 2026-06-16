-- Live transcription (opt-in, default off).
--
-- A meeting can opt into live captions (bot sources only). When its Recall bot
-- is in the call, the bot streams finalized transcript lines to
-- /api/webhooks/recall, which inserts them into live_utterances; the public
-- /meetings/[id]/live page polls a JSON endpoint to follow along. The existing
-- batch pipeline is unchanged and still produces the authoritative transcript.
--
-- Idempotent (if not exists) so re-running is safe, matching 0010/0011. RLS is
-- enabled on live_utterances with NO anon policy: the server reads/writes via
-- the service-role client (which bypasses RLS), like every other table here.

alter table meetings add column if not exists live_enabled boolean not null default false;
alter table meetings add column if not exists live_started_at timestamptz;
alter table meetings add column if not exists live_ended_at timestamptz;

alter table schedules add column if not exists live_enabled boolean not null default false;

create table if not exists live_utterances (
  id bigserial primary key,
  meeting_id uuid not null references meetings (id) on delete cascade,
  speaker_label text,
  text text not null,
  ts_seconds double precision,
  created_at timestamptz not null default now()
);

-- The live page polls "lines for this meeting with id > cursor, ascending".
create index if not exists live_utterances_meeting_id_id_idx
  on live_utterances (meeting_id, id);

-- RLS: locked down for anon (the service-role key bypasses). No policy for anon,
-- so anon has zero access; the server is the only writer/reader.
alter table live_utterances enable row level security;
