-- CivicScribe initial schema.
-- Run via the Supabase CLI: supabase db push (or supabase migration up).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- meetings
create table meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body_name text not null,
  source_type text not null check (source_type in ('zoom', 'stream', 'upload')),
  source_url text,
  status text not null default 'pending' check (
    status in ('pending', 'capturing', 'transcribing', 'summarizing', 'complete', 'failed')
  ),
  error_message text,
  scheduled_at timestamptz,
  audio_storage_path text,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create index meetings_created_at_idx on meetings (created_at desc);
create index meetings_status_idx on meetings (status);

-- ---------------------------------------------------------------------------
-- transcripts
create table transcripts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  raw_json jsonb not null,
  language text not null default 'en',
  created_at timestamptz not null default now()
);

create index transcripts_meeting_id_idx on transcripts (meeting_id);

-- ---------------------------------------------------------------------------
-- utterances, with generated tsvector + GIN index for full-text search
create table utterances (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts (id) on delete cascade,
  speaker_label text not null,
  speaker_name text,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  text_search tsvector generated always as (to_tsvector('english', text)) stored
);

create index utterances_transcript_id_idx on utterances (transcript_id, start_ms);
create index utterances_text_search_idx on utterances using gin (text_search);

-- ---------------------------------------------------------------------------
-- summaries
create table summaries (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  overview text not null,
  key_decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  full_markdown text not null,
  created_at timestamptz not null default now()
);

create index summaries_meeting_id_idx on summaries (meeting_id);

-- ---------------------------------------------------------------------------
-- speaker_aliases: map recurring "Speaker A" labels to real names per body
create table speaker_aliases (
  id uuid primary key default gen_random_uuid(),
  body_name text not null,
  speaker_label_pattern text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (body_name, speaker_label_pattern)
);

-- ---------------------------------------------------------------------------
-- jobs: simple Postgres-backed queue
create table jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  type text not null check (type in ('capture', 'transcribe', 'summarize', 'notify')),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'complete', 'failed')
  ),
  attempts integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_pending_idx on jobs (created_at) where status = 'pending';
create index jobs_meeting_id_idx on jobs (meeting_id);

-- Claim one pending job atomically. Safe under concurrent workers thanks to
-- FOR UPDATE SKIP LOCKED.
create or replace function claim_next_job()
returns setof jobs
language plpgsql
as $$
declare
  claimed jobs%rowtype;
begin
  select * into claimed
  from jobs
  where status = 'pending'
  order by created_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update jobs
  set status = 'running', updated_at = now()
  where id = claimed.id;

  claimed.status := 'running';
  return next claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- storage bucket for meeting audio
insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: single-user v1. Service-role key is used server-side; lock tables down
-- for anon access.
alter table meetings enable row level security;
alter table transcripts enable row level security;
alter table utterances enable row level security;
alter table summaries enable row level security;
alter table speaker_aliases enable row level security;
alter table jobs enable row level security;
