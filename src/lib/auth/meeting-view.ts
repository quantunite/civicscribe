// Ephemeral, single-meeting VIEW token (self-serve result page). Mirrors the
// HMAC token in lib/auth/session.ts (Web Crypto, edge-safe, base64url,
// constant-time compare, never throws), but scoped to ONE meeting: the token
// carries the meeting id (mid) + expiry, and verify rejects a token whose mid
// does not match the meeting being read.
//
// Minted ONLY on a genuine create (HTTP 201) for the caller who created the
// meeting, held in the browser tab's sessionStorage, and presented in the
// `x-cs-view` request header (never in a URL). It opens ONLY the meeting detail
// read for its one id: it does NOT grant export/download and does NOT widen the
// library/search/topics surfaces (those stay published-only). Signed with
// config.sessionSecret; in open mode (no sessionSecret) the published gate is
// already open, so the token is moot there.

/** Generous TTL so a long meeting does not strand the viewer mid-processing.
 *  The real ephemerality is sessionStorage (closes with the tab) + the absence
 *  of any shareable URL, not this number. */
export const MEETING_VIEW_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export interface MeetingViewPayload {
  /** The single meeting id this token authorizes a read of. */
  mid: string;
  /** Unix seconds. */
  exp: number;
}

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

/** Sign a view payload into `<body>.<sig>` (both base64url). */
export async function signMeetingView(
  payload: MeetingViewPayload,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  );
  return `${body}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify a view token for a specific meeting. Returns true ONLY when the
 * signature is valid, the token is not expired, AND payload.mid === meetingId
 * (so a token for meeting A is rejected for meeting B). Never throws.
 * `nowSeconds` is injectable for tests.
 */
export async function verifyMeetingView(
  token: string | null | undefined,
  secret: string,
  meetingId: string,
  nowSeconds?: number
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
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
    return false;
  }
  if (!constantTimeEqual(expectedSig, gotSig)) return false;

  let payload: MeetingViewPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return false;
  }
  if (
    !payload ||
    typeof payload.mid !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return false;
  }
  // Single-meeting scope: a valid token for A must never open B.
  if (payload.mid !== meetingId) return false;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return false;
  return true;
}
