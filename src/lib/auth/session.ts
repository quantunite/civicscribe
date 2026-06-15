// Stateless signed session token, verifiable in BOTH the edge middleware and
// Node route handlers via Web Crypto (globalThis.crypto.subtle, present in the
// edge runtime and Node 20+). No node:crypto and no Buffer, so it stays
// edge-safe. The token carries the user id + role + expiry, so authorizing a
// request needs no database lookup.

export type Role = "admin" | "moderator" | "user";

export interface SessionPayload {
  uid: string;
  role: Role;
  exp: number; // unix seconds
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const SESSION_COOKIE = "cs-session";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Sign a session payload into `<body>.<sig>` (both base64url). */
export async function signSession(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  );
  return `${body}.${bytesToBase64Url(sig)}`;
}

/** Verify a token: returns the payload if the signature is valid and the token
 *  is not expired, else null. Never throws. `nowSeconds` is injectable for
 *  tests. */
export async function verifySession(
  token: string | null | undefined,
  secret: string,
  nowSeconds?: number
): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let expectedSig: Uint8Array;
  let gotSig: Uint8Array;
  try {
    const key = await hmacKey(secret);
    expectedSig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(body))
    );
    gotSig = base64UrlToBytes(sigPart);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expectedSig, gotSig)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.uid !== "string" ||
    typeof payload.exp !== "number" ||
    (payload.role !== "admin" &&
      payload.role !== "moderator" &&
      payload.role !== "user")
  ) {
    return null;
  }
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  return payload;
}
