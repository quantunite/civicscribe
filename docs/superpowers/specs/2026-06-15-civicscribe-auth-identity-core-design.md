# CivicScribe Auth & Identity Core (Phase 1) — Design

Date: 2026-06-15
Status: Approved (design), pending implementation plan

## Context

Today CivicScribe authenticates with a single shared `OWNER_SECRET`. The UI carries it as the `cs-owner` HttpOnly cookie; scripts carry it as `Authorization: Bearer`. The edge middleware (`src/middleware.ts`) constant-time compares the cookie against `process.env.OWNER_SECRET` directly: no DB, no Node modules, no store import. Public submission is open-with-guardrails; publish/manage actions are admin-gated. When `OWNER_SECRET` is unset the middleware is a complete no-op, which keeps `MOCK_MODE` dev and the entire test suite green.

We are replacing the single shared secret with real per-user accounts while preserving that edge-safe, mock-no-op architecture.

## Locked decisions

- **Login scope:** admins/staff now; designed so public accounts can be switched on later without a rewrite ("admins now, accounts-ready").
- **Credential:** email + password.
- **Roles:** `admin`, `moderator`, `user` are all defined now; only **admin** accounts are issued in Phase 1. `moderator`/`user` are reserved for later phases.
- **Approach:** custom auth built **behind the existing store abstraction** (not Supabase Auth, not an auth library), so the mock/real store seam and the `MOCK_MODE`/test no-op invariant are preserved, and the middleware stays edge-safe.
- **Session mechanism:** a stateless **signed cookie** (HMAC), verifiable at the edge with Web Crypto, so authorization needs no DB lookup. (Alternative considered and rejected for Phase 1: opaque session id + DB lookup, which would force auth out of the edge middleware.)

## Phase 1 scope (this spec)

### Data model

New migration adds a `users` table:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `email` | citext | unique, not null (fallback: lowercased text + unique if citext unavailable) |
| `password_hash` | text | not null |
| `role` | text | not null, `default 'user'`, `check role in ('admin','moderator','user')` |
| `name` | text | nullable |
| `created_at` | timestamptz | `default now()` |

Store interface (`src/lib/store/types.ts`) gains: `getUserByEmail(email)`, `getUserById(id)`, `createUser({ email, passwordHash, role, name })`. Both the real (Supabase) and mock (in-memory) stores implement them; the mock store seeds a default dev admin. (`listUsers` / `updateUserRole` are deferred to Phase 2.)

### Password hashing

A server-only module (`src/lib/auth/password.ts`) using `node:crypto` **scrypt** (random salt, constant-time compare). Encoded as `scrypt$<params>$<salt>$<hash>`. No native dependencies, so it is Sophos-safe and runs anywhere Node runs. Never imported by edge code.

### Sessions (stateless signed cookie)

`src/lib/auth/session.ts` exposes `signSession({ uid, role, exp })` and `verifySession(token)`:

- Payload is `base64url(JSON)` + `.` + HMAC-SHA256 over the payload, keyed by `SESSION_SECRET`.
- **Edge verify path** uses Web Crypto (`crypto.subtle`) inside the middleware (no Node modules). **Node verify path** uses `node:crypto`. Both share one canonical payload encoding + algorithm.
- Cookie `cs-session`: HttpOnly, Secure (prod), SameSite=Lax, Path=/, Max-Age ~7 days; `exp` also embedded in the payload.
- Authorization reads `role` straight from the verified token: **no DB lookup** to gate a request. Revocation in Phase 1 is via expiry; an optional DB-backed session/deny-list is deferred.

### Routes

- `POST /api/login` — `{ email, password }` → verify against the store → set `cs-session` → `200 { user: { id, email, role, name } }`. Generic error on failure (no user-enumeration); constant-time compare. Hard rate-limiting deferred.
- `POST /api/logout` — clears `cs-session`.
- `/api/owner-login` is kept as an alias during cutover, then retired.

### Middleware & gating

- `src/middleware.ts` verifies `cs-session` at the edge and gates the **same** admin surfaces it gates today.
- **Hard invariant preserved:** when `SESSION_SECRET` is unset (dev / `MOCK_MODE` / tests) the middleware is a complete no-op (everyone passes), mirroring today's `OWNER_SECRET`-unset behavior, so the existing test suite stays green unchanged.
- `OWNER_SECRET` is retained as **break-glass**: a valid `OWNER_SECRET` Bearer/cookie still authorizes during cutover (keeps scripts and recovery working). Marked for removal in Phase 2.
- `src/lib/owner.ts` evolves into session helpers: `currentUser()` (decodes the cookie via `next/headers`) and `requireRole(request, roles[])` for route handlers (defense in depth, mirroring the middleware). The root layout uses `currentUser()` to render nav, admin UI, and sign-in/out. In Phase 1 the admin role is required wherever admin was required today (the admin/moderator split is Phase 2; moderator is simply not issued yet).

### Bootstrap

On startup/migration, if no admin exists and `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` are set, create the first admin. Idempotent, so you can never lock yourself out.

### UI

- Footer "Owner sign in" → "Sign in". `LoginForm` becomes email + password (replaces the `OwnerLoginForm` secret field), posting to `/api/login`.
- A small sign-in entry in the **header** that opens a login popover/modal, so there is no separate-page hop (the requested entry point). The login page remains as a fallback.
- When signed in, the header shows the user (name/email) + Sign out; admin nav stays role-gated.

### Config / env

- `SESSION_SECRET` — enables auth (unset = no-op dev mode).
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`.
- `OWNER_SECRET` — retained as break-glass for the cutover.

### Testing

- Unit: password hash/verify; session sign/verify with **edge + node parity**; middleware gating (no secret = open; with secret: missing cookie → redirect/401, valid admin cookie → pass, expired → deny); login/logout routes; mock store user methods.
- E2E: bootstrap admin → log in via the form → reach `/review` → sign out → blocked.
- Regression: with `SESSION_SECRET` unset, the whole suite stays no-op/green.

### Cutover

Deploy with `OWNER_SECRET` still set (break-glass) **plus** `SESSION_SECRET` and the bootstrap admin. Verify login end to end. A later phase removes `OWNER_SECRET`.

## Out of scope (Phase 1)

admin/moderator permission split; Users-management UI; `creator_user_id` attribution; schedule-edit UI; public signup; password reset; email verification; hardened rate limiting. All emails (below) are later phases.

## Roadmap (later phases)

- **Phase 2 — Roles & attribution:** admin-vs-moderator gating across protected actions; an admin **Users** screen (create users, set roles) with an **Account setup email** (set-password link); nullable `creator_user_id` on `meetings` + `schedules`; actor stamping on moderation/admin actions; retire `OWNER_SECRET`.
- **Phase 3 — Schedule editing:** edit UI + a "before it starts" guard, reusing the existing `ScheduleUpdate` type, `updateSchedule()` store method, and PATCH route. Editable predicate: `enabled && last_fired_at IS NULL && next_fire_at > now()`. Admin/moderator edit any; "edit your own" lands with Phase 4. Adds **Submission received** and **Published notification** emails (recipient = submitter account email or a `notify_email`; the scheduler fires Published on capture + publish).
- **Phase 4 — Public signup:** self-registration, default role `user`, **Signup email verification**, password reset, and "submit + edit your own submissions."

## Email touchpoints (all approved; later phases)

Account setup (P2), Submission received (P3), Published notification (P3), Signup verification (P4). Sent via the existing **Resend** provider.

## Risks / notes

- **Edge/node HMAC parity** is the main correctness risk: keep one canonical payload encoding + algorithm and test both verifiers against each other.
- **citext** is available on Supabase; if not, store a lowercased `email` with a unique constraint and normalize on read/write.
- **Do not break the no-op invariant:** every gate keys off `SESSION_SECRET` presence so `MOCK_MODE` and the existing suite are unaffected.
