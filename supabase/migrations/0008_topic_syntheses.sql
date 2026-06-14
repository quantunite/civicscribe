-- Phase 3: cross-meeting topic synthesis cache.
--
-- One AI-generated Markdown synthesis per topic slug, built ONLY from PUBLISHED
-- meetings. The server writes via the service-role client (bypasses RLS).
-- source_meeting_ids is the sorted set the synthesis was built from, used to
-- detect staleness: when the published set behind a slug changes, the cached
-- synthesis is regenerated (admin only) instead of being served as fresh.

create table topic_syntheses (
  slug text primary key,
  topic text not null,
  content text not null,
  source_meeting_ids uuid[] not null,
  meeting_count int not null,
  model text,
  generated_at timestamptz not null default now()
);

alter table topic_syntheses enable row level security;

-- Anon may read: the synthesis is derived entirely from published content, so
-- exposing it to the anon role is safe (mirrors the published-content read
-- policies in 0006). The server still reads via service-role (bypasses RLS).
-- There is no anon insert/update policy, so the anon role can never write here.
create policy "anon reads topic syntheses"
  on topic_syntheses for select
  to anon
  using (true);
