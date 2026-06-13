-- Distinguish civic meetings from Crash Course Corner educational videos.
-- Existing rows default to 'civic'.
alter table meetings
  add column kind text not null default 'civic' check (kind in ('civic', 'course'));

create index meetings_kind_idx on meetings (kind);
