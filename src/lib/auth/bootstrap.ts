// First-admin bootstrap. Idempotent and safe to call on demand (e.g. from the
// login route): if there are zero users and BOOTSTRAP_ADMIN_EMAIL/PASSWORD are
// both set, it seeds a single admin. This guarantees you can never lock
// yourself out of a fresh deploy. Node-runtime only (uses hashPassword).

import type { AppConfig } from "@/lib/config";
import type { DataStore } from "@/lib/store/types";
import { hashPassword } from "@/lib/auth/password";

/** Ensure a first admin exists. Returns the (lowercased) email that was
 *  created, or null when nothing was done (env unset, or users already exist).
 *  Never throws on the "already bootstrapped" path. */
export async function ensureBootstrapAdmin(
  store: DataStore,
  config: AppConfig
): Promise<string | null> {
  const email = config.bootstrapAdminEmail;
  const password = config.bootstrapAdminPassword;
  if (!email || !password) return null;
  if ((await store.countUsers()) > 0) return null;

  const normalized = email.trim().toLowerCase();
  // Guard against a race or a pre-existing same-email row.
  if (await store.getUserByEmail(normalized)) return null;

  await store.createUser({
    email: normalized,
    password_hash: await hashPassword(password),
    role: "admin",
    name: "Admin",
  });
  return normalized;
}
