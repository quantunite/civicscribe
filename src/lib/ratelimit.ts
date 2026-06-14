// In-process daily rate limiter.
//
// A single module-level Map holds a per-key counter plus the UTC day that
// counter belongs to. checkAndConsume increments the key's count for the
// current day; on the first call of a new UTC day the key's counter resets to
// zero before counting. limit is supplied per call so the same limiter backs
// several distinct caps (per-IP, global, ...).
//
// SCOPE / LIMITATIONS (intentional for v1):
//   - PER INSTANCE. The Map lives in one Node process, so counters are NOT
//     shared across replicas. CivicScribe runs at numReplicas=1 (see
//     railway.json / the design doc: two tick loops would double-spend), so a
//     single shared counter is correct today.
//   - RESETS ON REDEPLOY / RESTART. The Map is in memory only; a restart wipes
//     every counter. That is acceptable for an abuse guardrail (it fails open,
//     not closed) but means the daily cap is best-effort, not a hard ledger.
//   - A durable, DB-backed limiter (survives restarts, shared across replicas)
//     is the follow-up when this moves beyond a single replica.

export interface RateLimitResult {
  /** True when this call was within the limit (and has been counted). */
  allowed: boolean;
  /** Calls still permitted for this key on the current UTC day (never < 0). */
  remaining: number;
}

interface Counter {
  /** UTC day key (YYYY-MM-DD) the count belongs to. */
  day: string;
  /** Calls consumed so far on `day`. */
  count: number;
}

const counters = new Map<string, Counter>();

/** UTC calendar day (YYYY-MM-DD) the limiter buckets a timestamp into. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Count one use of `key` against `limit` for the UTC day of `now`.
 *
 * Returns { allowed, remaining }. When the call is within the limit it is
 * counted and `allowed` is true; once `limit` is reached the call is rejected
 * (`allowed: false`) WITHOUT incrementing further, so a blocked key cannot run
 * its deficit deeper. `remaining` is the headroom left after this call, clamped
 * at zero.
 *
 * `now` is injectable purely for testing day boundaries; production omits it.
 */
export function checkAndConsume(
  key: string,
  limit: number,
  now: Date = new Date()
): RateLimitResult {
  const day = dayKey(now);
  const existing = counters.get(key);

  // First use today (new key, or a stale counter from a previous day): reset.
  const count = existing && existing.day === day ? existing.count : 0;

  if (count >= limit) {
    // At/over the cap: reject without consuming. Persist the (possibly
    // day-reset) counter so a fresh day's first blocked call still rolls over.
    counters.set(key, { day, count });
    return { allowed: false, remaining: 0 };
  }

  const next = count + 1;
  counters.set(key, { day, count: next });
  return { allowed: true, remaining: Math.max(0, limit - next) };
}

/** Test-only: clear all counters so each test starts from a clean slate. */
export function __resetRateLimitsForTests(): void {
  counters.clear();
}
