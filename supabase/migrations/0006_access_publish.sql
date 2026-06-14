-- Phase 0: access + contribution model (the launch gate).
--
-- Generated items are NOT in the public library by default. An admin reviews a
-- moderation queue and approves an item to publish it; only published meetings
-- appear in public library browse/search. We also carry a nullable tenant_id
-- (single-tenant default now, per-gov isolation later without a destructive
-- migration) and a normalized source_key for dedup on submit.
--
-- Anon-role SELECT RLS is enabled on published content so the public site could
-- read directly if it ever needed to. The server reads via the service-role
-- client, which bypasses RLS, so server reads are unaffected either way.

-- ---------------------------------------------------------------------------
-- meetings: publish state + tenant + dedup key
alter table meetings
  add column published boolean not null default false,
  add column published_at timestamptz,
  add column tenant_id uuid,
  add column source_key text;

-- Library feed: published meetings, newest first.
create index meetings_published_created_at_idx
  on meetings (published, created_at desc);

-- Dedup lookups by normalized source key. PARTIAL UNIQUE (not a plain index):
-- two concurrent identical submits must not both insert and double-spend on
-- generation. The store catches the resulting unique violation and re-reads the
-- existing row (createMeeting backstop), so the loser of the race surfaces the
-- winner's meeting instead of erroring. NULL source_keys (uploads, unparseable
-- URLs) never dedup, so they are excluded from the constraint.
create unique index meetings_source_key_idx
  on meetings (source_key)
  where source_key is not null;

-- ---------------------------------------------------------------------------
-- anon-role SELECT RLS on published content.
--
-- RLS is already enabled on every table (0001 / 0005). The service-role key
-- bypasses RLS, so these policies only ever grant the anon role read access to
-- published content; everything else stays locked for anon.

-- meetings: anon may read only published rows.
create policy "anon reads published meetings"
  on meetings for select
  to anon
  using (published = true);

-- transcripts / utterances / summaries: derived from a meeting. Anon may read
-- those whose parent meeting is published. (A subquery keeps the policy simple;
-- the public path is low-volume and admin-curated.)
create policy "anon reads published transcripts"
  on transcripts for select
  to anon
  using (
    exists (
      select 1 from meetings m
      where m.id = transcripts.meeting_id and m.published = true
    )
  );

create policy "anon reads published utterances"
  on utterances for select
  to anon
  using (
    exists (
      select 1
      from transcripts t
      join meetings m on m.id = t.meeting_id
      where t.id = utterances.transcript_id and m.published = true
    )
  );

create policy "anon reads published summaries"
  on summaries for select
  to anon
  using (
    exists (
      select 1 from meetings m
      where m.id = summaries.meeting_id and m.published = true
    )
  );

-- schedules, jobs, and speaker_aliases stay fully locked for anon (no policy =
-- no anon access; service-role still bypasses RLS for server reads).
