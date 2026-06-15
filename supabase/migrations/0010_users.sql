-- Auth Phase 1: per-account login (email + password) with a role column.
--
-- Roles admin|moderator|user are all defined up front; only admin accounts are
-- issued in Phase 1 (moderator/user are reserved for later phases). RLS is
-- enabled with NO anon policy, so the anon role has zero access; the server
-- reads/writes via the service-role client, which bypasses RLS.
--
-- Email uniqueness is case-insensitive via a unique index on lower(email),
-- which avoids a citext extension dependency. The store normalizes email to
-- lowercase on read and write so plain `.eq("email", ...)` lookups match.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('admin', 'moderator', 'user')),
  name text,
  created_at timestamptz not null default now()
);

create unique index users_email_lower_idx on users (lower(email));

alter table users enable row level security;
-- No policy for anon: anon has no access. Service-role bypasses RLS for the
-- server, which is the only thing that touches this table.
