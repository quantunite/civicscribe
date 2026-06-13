// isInternalHost SSRF blocklist + URL helpers. The IPv6 cases (ULA, link-local,
// IPv4-mapped loopback, unspecified) were missing and are the point of this
// suite — a stream URL is handed to yt-dlp, so internal addresses must be
// rejected regardless of IP family.

import { describe, expect, it } from "vitest";

import { isInternalHost, isZoomHost, parseHttpUrl } from "@/lib/net/url";

describe("isInternalHost — blocks internal addresses", () => {
  it("blocks IPv4 loopback / private / link-local / unspecified", () => {
    for (const h of [
      "localhost",
      "foo.localhost",
      "thing.local",
      "127.0.0.1",
      "127.5.6.7",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.1.1",
      "0.0.0.0",
    ]) {
      expect(isInternalHost(h), h).toBe(true);
    }
  });

  it("blocks internal IPv6 (loopback, unspecified, ULA, link-local, mapped)", () => {
    for (const h of [
      "::1",
      "[::1]",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "feba::1",
      "::ffff:127.0.0.1",
      "[::ffff:10.0.0.1]",
    ]) {
      expect(isInternalHost(h), h).toBe(true);
    }
  });
});

describe("isInternalHost — allows public addresses", () => {
  it("allows public IPs and domains, including domains that start like IPv6", () => {
    for (const h of [
      "8.8.8.8",
      "example.com",
      "www.youtube.com",
      "2606:4700:4700::1111", // public Cloudflare IPv6
      "fc-barcelona.com", // a domain starting with "fc" must NOT be treated as ULA
      "fe-design.org",
    ]) {
      expect(isInternalHost(h), h).toBe(false);
    }
  });
});

describe("isZoomHost", () => {
  it("matches zoom.us and subdomains only", () => {
    expect(isZoomHost("zoom.us")).toBe(true);
    expect(isZoomHost("us02web.zoom.us")).toBe(true);
    expect(isZoomHost("notzoom.us")).toBe(false);
    expect(isZoomHost("zoom.us.evil.com")).toBe(false);
  });
});

describe("parseHttpUrl", () => {
  it("accepts http(s) and rejects other schemes / garbage", () => {
    expect(parseHttpUrl("https://x.com")?.hostname).toBe("x.com");
    expect(parseHttpUrl("http://x.com")?.hostname).toBe("x.com");
    expect(parseHttpUrl("ftp://x.com")).toBeNull();
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("not a url")).toBeNull();
  });
});
