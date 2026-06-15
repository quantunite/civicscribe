-- Microsoft Teams + Google Meet capture. Recall.ai bots join Teams and Google
-- Meet just like Zoom, so these route through the same bot capture path. Widen
-- the source_type CHECK constraints on both meetings and schedules to allow the
-- two new platforms. (Inline column checks get the default name
-- <table>_<column>_check; drop-if-exists keeps this safe if it was named.)

alter table meetings drop constraint if exists meetings_source_type_check;
alter table meetings
  add constraint meetings_source_type_check
  check (source_type in ('zoom', 'teams', 'meet', 'stream', 'upload'));

alter table schedules drop constraint if exists schedules_source_type_check;
alter table schedules
  add constraint schedules_source_type_check
  check (source_type in ('zoom', 'teams', 'meet', 'stream'));
