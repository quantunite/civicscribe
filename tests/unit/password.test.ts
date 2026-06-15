import { describe, it, expect } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", stored)).toBe(false);
  });

  it("salts: the same input hashes differently each time", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects malformed stored values without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "nodollars")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$zz$zz")).toBe(false);
  });
});
