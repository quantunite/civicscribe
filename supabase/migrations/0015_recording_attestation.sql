-- Clickwrap right-to-record + Terms/Privacy attestation, captured at submit time.
--
-- Distinct from the lawful-basis `attestation` column added in 0014 (public vs
-- authorized). This records the BINDING clickwrap agreement the submitter makes
-- at the moment of submission: they affirmed they are authorized to record the
-- meeting AND agreed to the Terms of Service and Privacy Policy. Persisting it
-- gives us a durable, per-submission record that the right-to-record warranty
-- was accepted, when, and against which version of the legal text.
--
--  * terms_agreed    — true once the submitter checked the required clickwrap
--                      box. False on legacy / server-seeded / scheduled rows
--                      that carry no submitter agreement.
--  * terms_agreed_at — server timestamp the agreement was recorded (null until).
--  * terms_version   — the version string of the Terms + Privacy in force when
--                      the submitter agreed (see src/lib/legal.ts TERMS_VERSION).
--                      Null until an agreement is recorded.
--
-- Idempotent (add column if not exists) so re-running is safe, matching 0014's
-- style. Defaults mean nothing changes for existing meetings (they read as
-- "no agreement on record").

alter table meetings add column if not exists terms_agreed boolean not null default false;
alter table meetings add column if not exists terms_agreed_at timestamptz;
alter table meetings add column if not exists terms_version text;
