# CivicScribe Terminal Production Design

Date: 2026-06-14
Status: approved (pending spec review)
Supersedes the deploy/library notes for scope purposes; builds on
2026-06-13-scheduled-capture-design.md.

## North star

A publicly browsable, referenceable **community library of civic knowledge**:
anyone can generate a transcript + summary from a meeting video or link, an admin
curates which generated items get published into the shared public library, and
the public can read, search, and cite that library. Runs on real Supabase +
AssemblyAI + Anthropic on Railway, hardened enough to publish the URL. Designed
so it can later be sold as gov/civic tech without a rewrite (tenant ready,
pluggable admin/roles), but full SaaS is explicitly deferred.

## Contribution and access model (decided)

Three roles of action, not three account types (v1 has no real accounts yet):

1. **Generate (public, open, with guardrails).** Anyone can submit a Zoom/stream
   URL or upload and get it processed into a transcript + summary. This is open
   on purpose. Because each generation spends real money (AssemblyAI + Anthropic),
   it is protected by cost/abuse guardrails (below), NOT by login.
2. **Publish to the library (admin gated).** Generated items are NOT in the public
   library by default. An admin reviews a moderation queue and approves an item
   to publish it. Only published items appear in public library browse/search.
3. **Manage (admin gated).** Delete, unpublish, edit speaker names, and all
   schedule routes require admin.

"Admin" in v1 is the single `OWNER_SECRET` (cookie for the UI, Bearer for
scripts), verified by one centralized check. The phrase "an account with admin
access" is the seed of real multi-user roles, deferred to productization.

**Duplicate detection:** on submit, normalize the source URL (and extract a
video id where possible) and flag a likely-existing item so the library does not
accumulate duplicates. The submitter sees the existing one instead of
re-generating.

### Cost / abuse guardrails for public generation (required for Phase 1)

- Per-IP daily submission limit + a max video length / upload size cap.
- A global daily spend cap that pauses public intake when hit (admin always
  exempt).
- Dedup short-circuits re-processing of an already-generated source.
- SSRF blocklist already covers internal hosts (src/lib/net/url.ts, IPv4 + IPv6).

## Commercial readiness stance (decided: design-ready, defer SaaS)

Two cheap pieces of insurance now; no speculative SaaS build:

- **Tenant-ready data model:** carry a nullable `tenant_id` (or `org`) on content
  tables, defaulting to a single tenant, so per-gov isolation can be added later
  without a destructive migration.
- **Centralized admin/role check:** one module (`src/lib/owner.ts` +
  `src/middleware.ts`) decides "is this request an admin?", so it can grow from a
  single secret into real accounts/roles in one place.

Deferred to a later **Phase 4: productization** (only when pursuing a sale):
real auth + roles + gov SSO, full multi-tenancy build-out, billing/usage
metering, audit logs, retention/PII policy, agenda-system integrations
(Granicus/Legistar), white-label branding.

## Phased plan

### Phase 0: Access + contribution model (the launch gate)
- One `OWNER_SECRET` in config.ts; `src/lib/owner.ts` (`isAdminRequest`) +
  `src/middleware.ts` (edge: read cookie OR Bearer, constant-time compare; total
  no-op when the secret is unset so MOCK_MODE and the whole test suite are
  unaffected). This is a hard invariant with its own unit test.
- Gate as admin: DELETE/manage meetings, speaker edits, all schedule routes,
  unpublish, and the new approve action. Leave OPEN: read routes, GET search,
  export, `/api/audio`, and the generate/submit routes (POST /api/meetings,
  /api/upload) which become public-with-guardrails. Tick + Recall webhook keep
  their existing secrets.
- Data model: add `published boolean default false` (+ `published_at`) and a
  nullable `tenant_id` to meetings; a normalized `source_key` for dedup with an
  index. New store methods: `listLibrary()` (published only), `publishMeeting`,
  `unpublishMeeting`, `findBySourceKey` (dedup), admin moderation queue list.
- UI: an admin moderation queue (approve/publish), a "submitted, pending review"
  state for public submitters, and `isAdmin` threaded from an async layout into
  SiteNav + cards (hide manage actions from the public).
- Migration `0006_access_publish.sql` (published/tenant_id/source_key + anon
  SELECT RLS on published content).
- Tests: middleware no-op-when-unset; gated path returns 401 unauthenticated and
  200 with the cookie/Bearer; dedup; publish/unpublish; listLibrary filters to
  published.

### Phase 1: Go-live on real backends + ops
- Flip Railway to real: `MOCK_MODE=false`, `SUPABASE_*`, `ASSEMBLYAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `APP_BASE_URL`, `TICK_SECRET`, `OWNER_SECRET`, upload cap.
- The cost guardrails above (per-IP limit, size/length caps, global daily spend
  cap) ship here, since public generation now spends real money.
- `/api/health` + Railway healthcheck; `src/lib/logger.ts` structured logs;
  per-job token/USD spend logging; security headers + CSP in next.config.ts;
  OG/Twitter metadata; audio `Cache-Control: public, max-age=86400, immutable`.
- Supabase Pro (free tier pauses weekly) + a weekly pg_dump backup.
- Exit criterion: e2e still green in MOCK_MODE (secret unset, middleware no-op).

### Phase 2: Public library browse + citations
- `/library` landing (topic cloud + governing bodies), `/tags/[slug]` topic
  browse (NOTE: `/topics` is reserved for Phase 3 synthesis), breadcrumbs,
  clickable topic chips, copyable per-utterance citation links. Published-only.
- Derived from existing `summaries.topics`; one GIN index (migration `0007`).
- `/library` becomes the public entry point; the operational dashboard `/` is
  admin-oriented.

### Phase 3: Cross-meeting knowledge synthesis (per-body first)
- New `synthesize` job type + `SynthesisProvider` (real Anthropic + mock), two
  tables (`corpus_topics`, `corpus_syntheses`), event-driven re-synthesis with a
  dedup guard and a hard token budget. Public `/topics` + `/topics/[slug]`.
- Migration `0008`. Auto-enqueue ships disabled; first per-body run is manual
  (observe logged cost), then enabled.

### Phase 4: Productization (deferred, noted only)
Real auth/roles + SSO, full multi-tenancy, billing/metering, audit logs,
retention/PII, agenda integrations, white-label. Pursue only when selling.

## Resolved cross-cutting conflicts (architect synthesis)
- `/topics` (synthesis) vs `/tags` (library topic browse): split, cross-linked.
- Migrations renumber 0006 (access/publish + RLS), 0007 (topics index), 0008
  (synthesis); applied in filename order against the one Supabase project.
- One `OWNER_SECRET` + one middleware + one config field (no duplicate
  WRITE_SECRET).
- Enabling anon-SELECT RLS is safe because the server reads via the service-role
  client (which bypasses RLS); verified.
- Audio `Cache-Control`: single value `public, max-age=86400, immutable`.
- The security boundary ships WITH a test (401 unauthenticated / 200 with
  credential), not untested.

## Key risks
- `OWNER_SECRET` is the whole boundary: keep it out of all logs; rotate by env.
- Public generation + real billing: the guardrails (per-IP, caps, global daily
  budget, dedup) are load-bearing, not optional.
- `numReplicas` must stay 1 (two in-process tick loops would double-claim and
  double-spend).
- No backups today: add a weekly pg_dump; civic transcripts are irreplaceable.
- The no-op-when-unset middleware contract is load-bearing for dev + tests.

## Out of scope (v1 terminal production)
Real user accounts / SSO, full multi-tenancy build, billing, per-topic and
cross-body synthesis, semantic/vector search, agenda-system integrations.
