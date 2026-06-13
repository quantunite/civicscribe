// LocalFileStorage.stat + getRange: ranged streaming so the audio route serves
// partial content without buffering the whole object in memory. (SupabaseFile-
// Storage streams via a signed-URL fetch and is verified live.)

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalFileStorage } from "@/lib/store/memory";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

const CONTENT = Buffer.from("0123456789abcdefABCDEF", "utf8"); // 22 bytes
const KEY = "meetings/m1/audio.bin";

let dataDir: string;
let storage: LocalFileStorage;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  storage = new LocalFileStorage(dataDir);
  await storage.put(KEY, CONTENT, "audio/mpeg");
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

async function readAll(
  stream: ReadableStream<Uint8Array> | null
): Promise<Buffer> {
  if (!stream) throw new Error("expected a stream, got null");
  return Buffer.from(await new Response(stream).arrayBuffer());
}

describe("LocalFileStorage.stat", () => {
  it("returns size and content type", async () => {
    expect(await storage.stat(KEY)).toEqual({
      size: CONTENT.byteLength,
      contentType: "audio/mpeg",
    });
  });

  it("returns null for a missing file", async () => {
    expect(await storage.stat("nope/missing.bin")).toBeNull();
  });
});

describe("LocalFileStorage.getRange", () => {
  it("streams the whole object when no range is given", async () => {
    const buf = await readAll(await storage.getRange(KEY));
    expect(buf.equals(CONTENT)).toBe(true);
  });

  it("streams exactly the requested inclusive byte range", async () => {
    const buf = await readAll(await storage.getRange(KEY, { start: 2, end: 5 }));
    expect(buf.toString("utf8")).toBe("2345");
  });

  it("streams a suffix-style range to the last byte", async () => {
    const buf = await readAll(
      await storage.getRange(KEY, { start: 20, end: 21 })
    );
    expect(buf.toString("utf8")).toBe("EF");
  });

  it("returns null for a missing file", async () => {
    expect(await storage.getRange("nope/missing.bin")).toBeNull();
  });
});
