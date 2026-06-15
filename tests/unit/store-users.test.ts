import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { MemoryStore } from "@/lib/store/memory";
import { ensureBootstrapAdmin } from "@/lib/auth/bootstrap";
import type { AppConfig } from "@/lib/config";

function freshStore(): MemoryStore {
  return new MemoryStore(join(tmpdir(), `cs-users-test-${randomUUID()}`));
}

const cfg = (o: Partial<AppConfig>) => o as AppConfig;

describe("store users (memory)", () => {
  it("creates and reads a user case-insensitively, normalizing email", async () => {
    const s = freshStore();
    const u = await s.createUser({
      email: "Admin@Example.COM",
      password_hash: "h",
      role: "admin",
      name: "A",
    });
    expect(u.email).toBe("admin@example.com");
    expect((await s.getUserByEmail("admin@example.com"))?.id).toBe(u.id);
    expect((await s.getUserByEmail("ADMIN@EXAMPLE.com"))?.id).toBe(u.id);
    expect((await s.getUserById(u.id))?.email).toBe("admin@example.com");
    expect(await s.countUsers()).toBe(1);
  });

  it("defaults role to user and name to null", async () => {
    const s = freshStore();
    const u = await s.createUser({ email: "x@y.com", password_hash: "h" });
    expect(u.role).toBe("user");
    expect(u.name).toBeNull();
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    const s = freshStore();
    await s.createUser({ email: "x@y.com", password_hash: "h" });
    await expect(
      s.createUser({ email: "X@Y.com", password_hash: "h2" })
    ).rejects.toThrow();
    expect(await s.countUsers()).toBe(1);
  });

  it("returns null for unknown lookups", async () => {
    const s = freshStore();
    expect(await s.getUserByEmail("nope@nope.com")).toBeNull();
    expect(await s.getUserById(randomUUID())).toBeNull();
  });
});

describe("ensureBootstrapAdmin", () => {
  it("creates the first admin when empty and env is set", async () => {
    const s = freshStore();
    const email = await ensureBootstrapAdmin(
      s,
      cfg({ bootstrapAdminEmail: "Boot@X.com", bootstrapAdminPassword: "pw" })
    );
    expect(email).toBe("boot@x.com");
    const u = await s.getUserByEmail("boot@x.com");
    expect(u?.role).toBe("admin");
    expect(await s.countUsers()).toBe(1);
  });

  it("is idempotent: no second admin on a second call", async () => {
    const s = freshStore();
    const c = cfg({
      bootstrapAdminEmail: "boot@x.com",
      bootstrapAdminPassword: "pw",
    });
    await ensureBootstrapAdmin(s, c);
    expect(await ensureBootstrapAdmin(s, c)).toBeNull();
    expect(await s.countUsers()).toBe(1);
  });

  it("no-ops when env is unset", async () => {
    const s = freshStore();
    expect(
      await ensureBootstrapAdmin(s, cfg({ bootstrapAdminEmail: null, bootstrapAdminPassword: null }))
    ).toBeNull();
    expect(await s.countUsers()).toBe(0);
  });

  it("does not seed when users already exist", async () => {
    const s = freshStore();
    await s.createUser({ email: "someone@x.com", password_hash: "h" });
    const email = await ensureBootstrapAdmin(
      s,
      cfg({ bootstrapAdminEmail: "boot@x.com", bootstrapAdminPassword: "pw" })
    );
    expect(email).toBeNull();
    expect(await s.countUsers()).toBe(1);
  });
});
