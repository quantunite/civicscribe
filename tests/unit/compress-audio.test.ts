// compressMeetingAudio is best-effort: when ffmpeg can't run (missing binary,
// encode error) it must return null so the caller uploads the original audio,
// never throwing and never failing the capture.

import { describe, expect, it } from "vitest";

import { compressMeetingAudio } from "@/lib/media/compress-audio";

describe("compressMeetingAudio", () => {
  it("returns null (does not throw) when ffmpeg is unavailable", async () => {
    // Point FFMPEG_PATH at a binary that does not exist so the spawn fails the
    // same way a runtime without ffmpeg would.
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "ffmpeg-does-not-exist-civicscribe";
    try {
      const result = await compressMeetingAudio(Buffer.from("not real audio"));
      expect(result).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });
});
