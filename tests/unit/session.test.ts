import { describe, it, expect } from "vitest";

import {
  signSession,
  verifySession,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

const SECRET = "test-session-secret";
const now = 1_700_000_000;
const future = now + SESSION_TTL_SECONDS;

describe("session token sign/verify", () => {
  it("round-trips a valid token", async () => {
    const token = await signSession(
      { uid: "u1", role: "admin", exp: future },
      SECRET
    );
    const payload = await verifySession(token, SECRET, now);
    expect(payload).toMatchObject({ uid: "u1", role: "admin", exp: future });
  });

  it("rejects a tampered body", async () => {
    const token = await signSession(
      { uid: "u1", role: "user", exp: future },
      SECRET
    );
    const [body, sig] = token.split(".");
    const tampered = `${body.slice(0, -2)}AA.${sig}`;
    expect(await verifySession(tampered, SECRET, now)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await signSession(
      { uid: "u1", role: "admin", exp: future },
      SECRET
    );
    expect(await verifySession(token, "other-secret", now)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(
      { uid: "u1", role: "admin", exp: now - 1 },
      SECRET
    );
    expect(await verifySession(token, SECRET, now)).toBeNull();
  });

  it("rejects garbage without throwing", async () => {
    expect(await verifySession(null, SECRET, now)).toBeNull();
    expect(await verifySession("", SECRET, now)).toBeNull();
    expect(await verifySession("nodot", SECRET, now)).toBeNull();
    expect(await verifySession(".sig", SECRET, now)).toBeNull();
    expect(await verifySession("body.", SECRET, now)).toBeNull();
  });
});
