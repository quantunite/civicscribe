// Site-wide security response headers, applied to every route by
// next.config.ts headers(). Kept here as a pure, testable function so the
// header set has a unit test and next.config.ts stays a thin wrapper.
//
// Notes on the CSP:
// - default-src 'self': everything same-origin unless widened below.
// - style-src adds 'unsafe-inline': next/font injects an inline <style> and
//   Tailwind utilities resolve to inline styles in places; without this the
//   pages render unstyled. (script-src stays 'self' + 'unsafe-inline' only for
//   Next's small inline bootstrap; no eval.)
// - img-src / media-src add data: (inline SVG/data URIs) and the configured
//   public origin so stored audio served from /api/audio (or a Supabase domain
//   behind it) loads. Supabase / Anthropic / AssemblyAI are all called
//   SERVER-side, so the browser needs no special connect-src for them.
// - frame-ancestors 'self' + X-Frame-Options SAMEORIGIN: no external framing.
// - object-src 'none', base-uri 'self': close off plugin + base-tag vectors.

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Only https origins are added to the CSP. A localhost / http dev origin is
 * already covered by 'self', and widening the policy to a non-https dev host
 * would be both useless and a footgun if it leaked into production.
 */
function extraOrigin(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Build the security header list applied to all routes.
 * `baseUrl` is the public origin (config.baseUrl / APP_BASE_URL); when it is a
 * real https host it is allowed as an img/media source for served audio.
 */
export function securityHeaders(baseUrl?: string): HeaderEntry[] {
  const origin = extraOrigin(baseUrl);
  const mediaSources = ["'self'", "data:", "blob:"];
  const imgSources = ["'self'", "data:", "blob:"];
  if (origin) {
    mediaSources.push(origin);
    imgSources.push(origin);
  }

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    // Next's runtime ships a tiny inline bootstrap script; no eval is used.
    "script-src 'self' 'unsafe-inline'",
    // next/font + Tailwind utilities emit inline styles.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${imgSources.join(" ")}`,
    `media-src ${mediaSources.join(" ")}`,
    // All third-party providers are server-side; the browser only talks to us.
    "connect-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  const permissionsPolicy = [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "browsing-topics=()",
    "interest-cohort=()",
  ].join(", ");

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Content-Security-Policy", value: csp },
    { key: "Permissions-Policy", value: permissionsPolicy },
  ];
}
