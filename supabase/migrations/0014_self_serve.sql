-- Self-serve result + "add to the public record" (design: docs/self-serve-transcript.md).
--
-- The submitter of a meeting can view their finished transcript + summary in the
-- moment (gated by an ephemeral, single-meeting VIEW token) and request that it
-- be added to the public record. Two new meeting columns back that:
--
--  * attestation        — the lawful basis the submitter affirmed at create time
--                         ('public' = open meeting of a public body; 'authorized'
--                         = the submitter has explicit authority to record it).
--                         Null for server-seeded / scheduled rows. Audit trail.
--  * publish_requested_at — when the submitter asked to add it to the public
--                         record. Null until requested; publication still
--                         requires staff approval (published / published_at).
--
-- Idempotent (if not exists / drop constraint if exists) so re-running is safe,
-- matching 0013's style. Both columns are null by default: nothing changes for
-- existing meetings.

alter table meetings add column if not exists attestation text;
alter table meetings add column if not exists publish_requested_at timestamptz;

-- Only the two lawful bases (or null) are valid. Drop-then-add so a re-run does
-- not error on an already-present constraint.
alter table meetings drop constraint if exists meetings_attestation_check;
alter table meetings
  add constraint meetings_attestation_check
  check (attestation is null or attestation in ('public', 'authorized'));
