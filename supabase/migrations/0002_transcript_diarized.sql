-- Mark how a transcript was produced. Audio transcription (AssemblyAI) is
-- diarized; caption-sourced transcripts (the caption fast lane) are not.
alter table transcripts
  add column diarized boolean not null default true;
