-- One-off (single future capture) schedules.
--
-- A one-off fires exactly once at a chosen future instant: recurrence is null
-- and next_fire_at is that instant. The sweep disables it after firing. A
-- recurring schedule keeps recurrence non-null and advances next_fire_at, so
-- recurrence becomes nullable to hold both kinds in one table.

alter table schedules add column one_off boolean not null default false;
alter table schedules alter column recurrence drop not null;
