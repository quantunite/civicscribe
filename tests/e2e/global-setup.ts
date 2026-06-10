import { rm } from "node:fs/promises";
import path from "node:path";

// Wipe the e2e data dir so every run starts from an empty store.
export default async function globalSetup(): Promise<void> {
  const dir = path.resolve(__dirname, "../../.data-e2e");
  await rm(dir, { recursive: true, force: true });
}
