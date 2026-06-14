// Security headers applied to every route via next.config.ts headers().
// The header SET is extracted into a pure module so it can be unit-tested
// without booting Next. next.config.ts is a thin wrapper around this.

import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/http/security-headers";

function headerMap(baseUrl?: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const { key, value } of securityHeaders(baseUrl)) m.set(key, value);
  return m;
}

describe("securityHeaders", () => {
  it("sets the core hardening headers", () => {
    const h = headerMap();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(h.has("Permissions-Policy")).toBe(true);
    expect(h.has("Content-Security-Policy")).toBe(true);
  });

  it("CSP defaults to self and forbids framing/objects", () => {
    const csp = headerMap().get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("CSP allows data: images/media so inline assets render", () => {
    const csp = headerMap().get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/img-src[^;]*data:/);
    expect(csp).toMatch(/media-src[^;]*data:/);
  });

  it("CSP allows the inline styles next/font + Tailwind emit", () => {
    const csp = headerMap().get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it("Permissions-Policy disables sensitive features", () => {
    const pp = headerMap().get("Permissions-Policy") ?? "";
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);
  });

  it("adds the configured base origin to img/media-src when it is a real host", () => {
    const csp =
      headerMap("https://civicscribe.up.railway.app").get(
        "Content-Security-Policy"
      ) ?? "";
    expect(csp).toContain("https://civicscribe.up.railway.app");
  });

  it("does not inject a localhost origin into the CSP (dev default)", () => {
    const csp =
      headerMap("http://localhost:3000").get("Content-Security-Policy") ?? "";
    // localhost is already covered by 'self' in dev; never widen the policy
    // to a non-https dev origin.
    expect(csp).not.toContain("http://localhost:3000");
  });

  it("returns a stable, non-empty list", () => {
    const list = securityHeaders();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(typeof entry.key).toBe("string");
      expect(typeof entry.value).toBe("string");
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.value.length).toBeGreaterThan(0);
    }
  });
});
