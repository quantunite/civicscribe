// Shared source-URL validation used by both the on-demand meeting route and
// the schedule route, so the two enforce the same http(s) + SSRF blocklist.

export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isZoomHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "zoom.us" || host.endsWith(".zoom.us");
}

/**
 * Reject obviously-internal hosts for stream URLs (the server hands them to
 * yt-dlp, which will happily fetch them). A deliberate "obvious cases"
 * blocklist — localhost, *.local, loopback/private/link-local IPv4, [::1],
 * 0.0.0.0. DNS-rebinding-grade SSRF protection is out of scope for single-user
 * v1.
 */
export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8 "this network"
  }
  return false;
}
