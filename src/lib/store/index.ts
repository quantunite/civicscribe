// Store factory. Singletons are kept on globalThis so Next.js dev-mode module
// reloads don't reset in-memory state mid-session.

import { getConfig } from "@/lib/config";
import type { DataStore, FileStorage } from "@/lib/store/types";
import { MemoryStore, LocalFileStorage } from "@/lib/store/memory";
import { SupabaseStore, SupabaseFileStorage } from "@/lib/store/supabase";

const g = globalThis as unknown as {
  __civicscribeStore?: DataStore;
  __civicscribeFiles?: FileStorage;
};

function useSupabase(): boolean {
  const config = getConfig();
  return !config.mockMode && !!config.supabaseUrl;
}

export function getStore(): DataStore {
  if (!g.__civicscribeStore) {
    const config = getConfig();
    g.__civicscribeStore = useSupabase()
      ? new SupabaseStore(config)
      : new MemoryStore(config.dataDir);
  }
  return g.__civicscribeStore;
}

export function getFileStorage(): FileStorage {
  if (!g.__civicscribeFiles) {
    const config = getConfig();
    g.__civicscribeFiles = useSupabase()
      ? new SupabaseFileStorage(config)
      : new LocalFileStorage(config.dataDir);
  }
  return g.__civicscribeFiles;
}
