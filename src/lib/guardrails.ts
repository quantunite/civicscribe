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
import { isAdminRequest } from "@/lib/owner";
import { checkAndConsume } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

/** Single shared key for the global daily submission counter. */
export const GLOBAL_RATE_KEY = "global:submits";

/**
 * Best-effort client IP. Railway puts the real client first in
 * x-forwarded-for; we take that first hop, then fall back to x-real-ip, then a
 * sentinel so a missing header buckets together rather than throwing.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
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
