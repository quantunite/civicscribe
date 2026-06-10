// Shared helpers for unit tests. Each test gets a unique temp dataDir so
// MemoryStore instances never share state across tests or test files.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppConfig } from "@/lib/config";

/** Create a unique temp directory for a MemoryStore dataDir. */
export async function makeTempDataDir(): Promise<string> {
  return mkdtemp(
    path.join(tmpdir(), `civicscribe-vitest-${randomUUID().slice(0, 8)}-`)
  );
}

/** Best-effort recursive cleanup of a temp dataDir. */
export async function cleanupDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Fully-populated AppConfig for constructing real providers in tests. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mockMode: false,
    baseUrl: "http://localhost:3000",
    supabaseUrl: null,
    supabaseAnonKey: null,
    supabaseServiceRoleKey: null,
    assemblyAiApiKey: null,
    anthropicApiKey: null,
    anthropicModel: "claude-sonnet-4-6",
    recallApiKey: null,
    recallRegion: "us-west-2",
    resendApiKey: null,
    notifyEmail: null,
    dataDir: ".data-test-unused",
    ...overrides,
  };
}
