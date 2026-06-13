// fetchCaptions on the stream-ingest providers (mock fixture / opt-out, and
// the real provider's disabled-returns-null path which spawns nothing).

import { describe, expect, it } from "vitest";
import { MockStreamIngestProvider } from "@/lib/providers/mock/stream";
import { YtDlpStreamIngestProvider } from "@/lib/providers/real/ytdlp";
import { testConfig } from "./helpers";

describe("MockStreamIngestProvider.fetchCaptions", () => {
  const p = new MockStreamIngestProvider();

  it("returns a non-diarized transcript for a normal URL", async () => {
    const r = await p.fetchCaptions("https://youtube.com/watch?v=abc");
    expect(r).not.toBeNull();
    expect(r!.utterances.length).toBeGreaterThan(0);
    expect(r!.utterances[0].speaker_label).toBe("CAPTION");
  });

  it("returns null when the URL signals no captions", async () => {
    const r = await p.fetchCaptions("https://example.com/nocaptions/v");
    expect(r).toBeNull();
  });
});

describe("YtDlpStreamIngestProvider.fetchCaptions", () => {
  it("returns null immediately when the fast lane is disabled (no spawn)", async () => {
    const p = new YtDlpStreamIngestProvider(
      testConfig({ captionFastLane: false })
    );
    const r = await p.fetchCaptions("https://youtube.com/watch?v=abc");
    expect(r).toBeNull();
  });
});
