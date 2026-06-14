-- Phase 2: public library topic browse (/tags).
--
-- The /tags surface is derived entirely from the existing summaries.topics
-- jsonb array (no new tables). As the published corpus grows, listTopics() and
-- getTopicMeetings() scan every published meeting's topics; a GIN index on the
-- jsonb column keeps containment / array lookups cheap.
--
-- Additive only: no column or data changes. jsonb_path_ops is the smaller,
-- faster operator class for the @> containment queries these surfaces use.

create index if not exists summaries_topics_gin_idx
  on summaries using gin (topics jsonb_path_ops);
