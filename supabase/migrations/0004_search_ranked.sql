-- Recency-ranked full-text search over utterances.
--
-- Bug fix: the previous query applied LIMIT to a (start_ms, id)-ordered fetch
-- BEFORE the application's newest-meeting-first sort, so when matches exceeded
-- the limit the DB could return only older meetings' utterances and the newest
-- meetings' hits were dropped. Ordering by meetings.created_at in SQL makes the
-- fetched window and the final order agree, so the LIMIT keeps the newest hits.
--
-- Mirrors orderSearchResults() (src/lib/store/search-order.ts) exactly:
-- created_at DESC, then meeting id, then within-meeting start_ms.

create or replace function search_utterances(
  p_query text,
  p_limit int default 100,
  p_meeting_id uuid default null
)
returns table (
  id uuid,
  transcript_id uuid,
  speaker_label text,
  speaker_name text,
  start_ms integer,
  end_ms integer,
  text text,
  meeting_id uuid,
  meeting_title text,
  meeting_body_name text,
  meeting_created_at timestamptz
)
language sql
stable
as $$
  select
    u.id, u.transcript_id, u.speaker_label, u.speaker_name,
    u.start_ms, u.end_ms, u.text,
    m.id, m.title, m.body_name, m.created_at
  from utterances u
  join transcripts t on t.id = u.transcript_id
  join meetings m on m.id = t.meeting_id
  where u.text_search @@ websearch_to_tsquery('english', p_query)
    and (p_meeting_id is null or m.id = p_meeting_id)
  order by m.created_at desc, m.id, u.start_ms
  limit greatest(p_limit, 0);
$$;
