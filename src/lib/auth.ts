// Minimal single-user authentication for hosted deployments.
//
// CivicScribe was built as a no-auth personal archive. When it runs on a
// public URL that assumption is dangerous: anyone could submit meetings
// (burning API credits) or read the archive. This module adds a single
// shared-password gate, off by default so local mock-mode dev and the test
// suites keep working with zero config.
//
// Auth is ENABLED whenever APP_PASSWORD is set, and OFF otherwise.
//
// Everything here uses only Web Crypto + Web globals (no node: imports) so it
// can run inside Next.js edge middleware as well as Node route handlers.

/** Name of the signed session cookie. */
export const SESSION_COOKIE = "cs_session";

/** Default session lifetime: 30 days. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Auth is on exactly when a password is configured. */
export function isAuthEnabled(): boolean {
  return readEnv("APP_PASSWORD") !== null;
}

/** Secret used to sign session cookies: AUTH_SECRET if set, else the password
 *  itself (changing the password then invalidates outstanding sessions). */
function signingSecret(): string | null {
  const password = readEnv("APP_PASSWORD");
  if (password === null) {
    return null;
  }
  return readEnv("AUTH_SECRET") ?? password;
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

/** Constant-time string comparison (avoids leaking length-prefix matches). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** True when the supplied password matches the configured one. */
export function checkPassword(input: string): boolean {
  const password = readEnv("APP_PASSWORD");
  if (password === null) {
    return false;
  }
  return timingSafeEqual(input, password);
}

/** Mint a signed session token of the form `<payload>.<signature>`. */
export async function createSessionToken(
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const secret = signingSecret();
  if (secret === null) {
    throw new Error("createSessionToken called while auth is disabled");
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ exp }))
  );
  const signature = toBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<boolean> {
  const secret = signingSecret();
  if (secret === null || !token) {
    return false;
  }
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return false;
  }
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = toBase64Url(await hmac(secret, payload));
  if (!timingSafeEqual(signature, expected)) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload))
    ) as { exp?: unknown };
    if (typeof decoded.exp !== "number") {
      return false;
    }
    return decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Cookie attributes shared by login (set) and logout (clear). */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return new Uint8Array(signature);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
