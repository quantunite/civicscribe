// Shared-secret request auth for the otherwise-unauthenticated control routes
// (/api/jobs/tick and /api/webhooks/recall). Open by default so the app boots
// with only MOCK_MODE=true; enforced once the corresponding secret env var is
// set, which is the prerequisite for exposing the app publicly.

import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of a caller-supplied value against a configured secret.
 *
 * - No secret configured (null/empty) -> always authorized (single-user/dev).
 * - Otherwise the provided value must match. Accepts either a raw secret or an
 *   "Authorization: Bearer <secret>" header value.
 */
export function isAuthorized(
  provided: string | null,
  secret: string | null
): boolean {
  if (!secret) return true;
  if (!provided) return false;
  const token = provided.startsWith("Bearer ")
    ? provided.slice("Bearer ".length)
    : provided;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on length mismatch; the length check both guards
  // that and short-circuits an obvious non-match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
