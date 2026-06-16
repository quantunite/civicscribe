-- Live "catch me up" recap (rolling, cached, shared).
--
-- A meeting that is being captured live (migration 0012) gains a single rolling
-- recap of what has been covered so far, served to every viewer of the public
-- /meetings/[id]/live page. The live poll endpoint refreshes it lazily and
-- fire-and-forget (at most ~once per 2 minutes per live meeting, only while
-- someone is polling), feeding the prior recap plus only the new live_utterances
-- to the LLM so input stays bounded on long meetings.
--
-- One recap per meeting; no new table. Idempotent (if not exists) so re-running
-- is safe, matching 0012's style. All three columns are null by default: nothing
-- changes for existing meetings until a live meeting accrues lines + has a viewer.

alter table meetings add column if not exists live_summary text;
alter table meetings add column if not exists live_summary_through_id bigint;
alter table meetings add column if not exists live_summary_at timestamptz;
