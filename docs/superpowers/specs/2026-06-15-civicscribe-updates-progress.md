# CivicScribe updates — build progress (loop: "until updates are finished and live")

Branch: `feat/auth-identity-core`. Spec: `2026-06-15-civicscribe-auth-identity-core-design.md`.

This checklist is the durable work list for the autonomous build loop. Update it as items land.

## 1. Auth Phase 1 (identity core) — approved spec

- [x] `src/lib/auth/password.ts` — scrypt hash/verify (node:crypto), unit-tested
- [x] `src/lib/auth/session.ts` — HMAC signed token, edge+node via Web Crypto, unit-tested
- [ ] `users` migration (id, email unique, password_hash, role check admin|moderator|user, name, created_at)
- [ ] store interface: `getUserByEmail` / `getUserById` / `createUser` (types + mock + real/supabase); mock seeds a dev admin
- [ ] first-admin bootstrap from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
- [ ] `POST /api/login` + `POST /api/logout` (set/clear `cs-session`)
- [ ] `config.ts`: add `sessionSecret`, bootstrap admin envs
- [ ] middleware: verify `cs-session` at edge + role-gate; keep `OWNER_SECRET` as break-glass; full no-op when `SESSION_SECRET` unset (preserve test suite)
- [ ] `owner.ts` -> session helpers (`currentUser`, `requireRole`); layout renders nav/sign-in-out from it
- [ ] UI: rename "Owner sign in" -> "Sign in"; email+password `LoginForm`; inline header login entry
- [ ] tests: middleware (session-based), login/logout routes; e2e login -> reach `/review`
- [ ] regression: whole suite stays green with `SESSION_SECRET` unset

## 2. Schedule editing (original ask)

- [ ] edit UI + "before it starts" guard (`enabled && last_fired_at IS NULL && next_fire_at > now()`), reusing existing `ScheduleUpdate` / `updateSchedule()` / PATCH
- [ ] admin/moderator edit any; per-user "edit own" deferred to public-accounts phase

## 3. Instructional main page + cinematic civic landing (new request, 2026-06-15)

- [ ] home page (`src/app/page.tsx`) becomes a how-to-use-the-platform guide (what CivicScribe does, how to submit a Zoom/stream/upload, how scheduling works, where the archive/search live). Keep the archive reachable.
- [ ] design it with the frontend-design (cinematic) skill: aesthetically striking but POLITICALLY APPROPRIATE / non-partisan civic tone (e.g., a realistic meeting/council-chamber scene, an American flag motif, government-civic palette). Tasteful, not campaign-y.
- [ ] the home page also surfaces the sign-in entry (ties to the auth "Sign in" affordance).

## 4. Deploy / "live" (handoff)

- [ ] push branch; open PR or merge to master per deploy flow
- [ ] HANDOFF: user sets Railway env `SESSION_SECRET` + `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` to turn auth ON (code is a no-op until then). Loop pauses + pings when here.
