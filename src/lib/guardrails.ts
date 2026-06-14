// Cost/abuse guardrails for the PUBLIC generate routes (POST /api/meetings,
// POST /api/upload). Public generation spends real money on AssemblyAI +
// Anthropic, so each submission is counted against two daily caps:
//   - per client IP   (config.maxSubmitsPerIpPerDay)
//   - globally        (config.maxSubmitsGlobalPerDay), a coarse intake brake
//
// HARD INVARIANT: the admin (isAdminRequest) is exempt. Because isAdminRequest
// returns true for EVERYONE when OWNER_SECRET is unset, the guardrails are a
// complete no-op in dev and MOCK_MODE, leaving the test suite unaffected.
//
// Counting order matters: the per-IP cap is checked and consumed FIRST. Only if
// it passes is the global cap consumed, so a single abusive IP being blocked
// does not burn the shared global budget.

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { isInternalHost } from "@/lib/net/url";
import { isAdminRequest } from "@/lib/owner";
import { checkAndConsume } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

/** Single shared key for the global daily submission counter. */
export const GLOBAL_RATE_KEY = "global:submits";

/**
 * Best-effort client IP for per-IP rate-limit bucketing.
 *
 * SECURITY: x-forwarded-for is a list the proxies PREPEND/APPEND to, and the
 * LEFTMOST hop is whatever the client itself sent. A client can forge
 * `X-Forwarded-For: <random>` and the platform edge forwards it, so the
 * leftmost value is attacker-controlled and trusting it lets an abuser mint a
 * fresh per-IP budget on every request (the per-IP cap is then a no-op). The
 * trustworthy value is the RIGHTMOST hop appended by our own infrastructure:
 * the platform edge (Railway) appends the real connecting IP last.
 *
 * We therefore walk the XFF chain from the RIGHT and return the last hop that
 * is not a private/internal proxy address (reusing the SSRF host classifier),
 * which is the closest-to-edge public client IP we can attribute. If every hop
 * is internal (or XFF is absent) we fall back to x-real-ip, then to a sentinel
 * so a missing header buckets together rather than throwing.
 *
 * Trusted-proxy assumption: this treats the edge as appending the real client
 * IP on the right and assumes intermediate hops we add are private/internal.
 * It is NOT a defense against an attacker who can inject a public IP as the
 * rightmost hop (only possible if something upstream of our edge is trusted),
 * which is out of scope for the single-edge Railway deployment.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    // Walk from the right (edge-appended) and take the last public hop.
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isInternalHost(hops[i])) return hops[i];
    }
    // All hops are private/internal: fall through to x-real-ip / sentinel
    // rather than trust the spoofable leftmost value.
  }
  const real = request.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}

/**
 * Enforce the public-submission guardrails for a generate request.
 *
 * Returns null when the request may proceed (admin/open-mode, or within both
 * caps). Returns a 429 JSON Response when a daily cap is exceeded. On a block
 * nothing further is consumed.
 */
export function enforceSubmitGuardrails(request: Request): NextResponse | null {
  // Admin (and open-mode, where everyone is admin) is fully exempt.
  if (isAdminRequest(request)) return null;

  const config = getConfig();
  const ip = clientIp(request);

  const perIp = checkAndConsume(`ip:${ip}`, config.maxSubmitsPerIpPerDay);
  if (!perIp.allowed) {
    log.warn("guardrail: per-IP daily submission limit hit", {
      ip,
      limit: config.maxSubmitsPerIpPerDay,
    });
    return tooManyRequests(
      "Daily submission limit reached for your network. Please try again tomorrow."
    );
  }

  const global = checkAndConsume(
    GLOBAL_RATE_KEY,
    config.maxSubmitsGlobalPerDay
  );
  if (!global.allowed) {
    log.warn("guardrail: global daily submission limit hit", {
      limit: config.maxSubmitsGlobalPerDay,
    });
    return tooManyRequests(
      "We have reached today's processing capacity. Please try again tomorrow."
    );
  }

  return null;
}

function tooManyRequests(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 429 });
}
