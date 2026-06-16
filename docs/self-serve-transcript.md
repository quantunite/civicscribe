# CivicScribe self-serve result + "add to the public record" (design)

Status: approved 2026-06-16. Builds on the public submit flow + the staff
approval/publish gate. Ships default-safe.

## Goal

Let the person who submits a meeting SEE their finished transcript + summary in
the moment so the service is useful to them, while pushing them toward the public
library as the only path to a lasting copy. Public publication still requires
staff approval.

## Locked decisions (with Amel, incl. red-team pivot)

- VIEW-ONLY. The submitter can read the transcript + summary in the moment.
  NO download and NO email of an unpublished meeting. (A downloadable/emailable
  copy is a permanent copy, which defeats the "no unofficial library" goal; with
  view-only, the only durable copy is the staff-approved public record.)
- PUSH TO THE LIBRARY. The result page's primary action is "Add this to the
  public record" (a submitter-initiated request surfaced in the staff review
  queue). The library, after approval, is the durable/shareable artifact.
- EPHEMERAL + creation-bound. Access is a short-lived, single-meeting,
  HMAC-signed VIEW token held in the browser tab (sessionStorage), never in the
  URL. It is minted ONLY on a genuine create (201) by the caller who created the
  meeting, NOT on the dedup path and NOT from mere knowledge of the source URL.
- ATTESTATION (one of two lawful bases). Submitting requires the submitter to
  affirm EITHER (a) "this is an open meeting of a public body," OR (b) "I have
  explicit authority to record this meeting and add it to the public library."
  The chosen basis is stored as an audit trail. (Scopes self-serve recording to
  a lawful basis; cheap insurance against recording-consent exposure.)
- No account needed.

## Data model (migration 0014)

`meetings` gains: `attestation text` (null; CHECK in ('public','authorized') —
which lawful basis the submitter affirmed) and `publish_requested_at timestamptz`.

## Access matrix (the published gate, extended)

A meeting's transcript/summary is readable when: it is published, OR the caller
is staff, OR the caller presents a valid VIEW token for THAT meeting id.
- The view token grants READ of the detail (transcript + summary) for one id.
- The view token does NOT grant export/download (the export route stays
  published-or-staff only, so unpublished cannot be downloaded).
- Library, search, topics stay published-only (the token never widens them).

## Token

`src/lib/auth/meeting-view.ts`: signMeetingView({ mid, exp }) /
verifyMeetingView(token, meetingId) via Web Crypto HMAC (mirrors auth/session).
Signed with SESSION_SECRET. Scoped to one meeting (verify rejects a mismatched
id). Generous TTL (~6h) so long meetings do not strand the viewer; the real
ephemerality is sessionStorage (tab close) + no shareable URL. In open mode (no
SESSION_SECRET, e.g. dev/mock), the published gate is already open so the token
is moot.

## Flows

- Submit (POST /api/meetings, /api/upload): require `attestation` to be 'public'
  or 'authorized' (client + server) and persist it. On a genuine NEW meeting
  (201), mint a VIEW token and return `{ meeting, viewToken }`. On a dedup hit,
  do NOT return the meeting id or a token to a non-staff caller; return a neutral
  "already submitted, pending review."
- Result page `/meetings/[id]/result` (client): reads the VIEW token from
  sessionStorage (the submit form stored it on success), polls
  GET /api/meetings/[id] with the token, shows processing status then the
  transcript + summary VIEW-ONLY. Primary CTA "Add this to the public record" ->
  POST /api/meetings/[id]/request-publish (with the token) sets
  publish_requested_at. Clear copy: this view is private + temporary + view-only;
  to keep or share it, add it to the public record.
- Staff review queue: surface publish_requested_at (a "submitter requested"
  badge; requested-first ordering) so staff see intent.

## Tests

- token: sign/verify, single-id scope (valid for A, rejected for B), expiry.
- detail API: valid token -> 200 for that id; wrong/absent token + unpublished ->
  404; other-id token -> 404; published -> 200 as before.
- export API: VIEW token does NOT grant download of an unpublished meeting (404).
- submit: missing/invalid attestation -> 400; the chosen basis is persisted;
  dedup hit -> no id/token to non-staff.
- request-publish: sets publish_requested_at; idempotent.
