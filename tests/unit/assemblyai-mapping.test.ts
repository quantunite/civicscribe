// AssemblyAI response -> DiarizedUtterance mapping in the real
// TranscriptionProvider. Global fetch is stubbed with canned upload /
// create-transcript / poll responses; the canned transcript completes on the
// first poll so no real polling delay is incurred.

import { afterEach, describe, expect, it, vi } from "vitest";

import { AssemblyAiTranscriptionProvider } from "@/lib/providers/real/assemblyai";
import { testConfig } from "./helpers";

const UPLOAD_URL = "https://cdn.assemblyai.com/upload/fake-upload-id";
const TRANSCRIPT_ID = "tr_test_123";

/** Canned completed transcript exercising null/missing utterance fields. */
const COMPLETED_TRANSCRIPT = {
  id: TRANSCRIPT_ID,
  status: "completed",
  language_code: "en_us",
  audio_duration: 1860, // seconds
  utterances: [
    { speaker: "A", start: 0, end: 4200, text: "Call to order." },
    { speaker: "B", start: 4300, end: 9100, text: "Roll call, please." },
    // Every field null — mapping must fall back, not crash.
    { speaker: null, start: null, end: null, text: null },
    // start missing entirely, text present.
    { speaker: "C", end: 15000, text: "Missing start time." },
    // speaker missing entirely.
    { start: 16000, end: 17000, text: "Anonymous remark." },
  ],
};

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Install a fetch stub that answers the three AssemblyAI endpoints. */
function stubAssemblyAiFetch(
  transcript: Record<string, unknown> = COMPLETED_TRANSCRIPT
): RecordedCall[] {
  const calls: RecordedCall[] = [];

  const fakeFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      );
      let body: unknown = init?.body ?? null;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          // keep as string
        }
      }
      calls.push({ url, method, headers, body });

      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (url.endsWith("/v2/upload") && method === "POST") {
        return json({ upload_url: UPLOAD_URL });
      }
      if (url.endsWith("/v2/transcript") && method === "POST") {
        return json({ id: TRANSCRIPT_ID, status: "queued" });
      }
      if (url.endsWith(`/v2/transcript/${TRANSCRIPT_ID}`) && method === "GET") {
        return json(transcript);
      }
      return json({ error: `unexpected request: ${method} ${url}` }, 500);
    }
  );

  vi.stubGlobal("fetch", fakeFetch);
  return calls;
}

function makeProvider() {
  return new AssemblyAiTranscriptionProvider(
    testConfig({ assemblyAiApiKey: "test-aai-key" })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssemblyAiTranscriptionProvider mapping", () => {
  it("maps utterances: speaker->speaker_label, start/end->ms, text verbatim", async () => {
    stubAssemblyAiFetch();
    const result = await makeProvider().transcribe({
      kind: "url",
      url: "https://example.com/audio.wav",
    });

    expect(result.utterances).toHaveLength(5);
    expect(result.utterances[0]).toEqual({
      speaker_label: "A",
      start_ms: 0,
      end_ms: 4200,
      text: "Call to order.",
    });
    expect(result.utterances[1]).toEqual({
      speaker_label: "B",
      start_ms: 4300,
      end_ms: 9100,
      text: "Roll call, please.",
    });
  });

  it("falls back on null/missing fields: Unknown speaker, 0 ms, empty text", async () => {
    stubAssemblyAiFetch();
    const result = await makeProvider().transcribe({
      kind: "url",
      url: "https://example.com/audio.wav",
    });

    // All-null utterance.
    expect(result.utterances[2]).toEqual({
      speaker_label: "Unknown",
      start_ms: 0,
      end_ms: 0,
      text: "",
    });
    // Missing start only.
    expect(result.utterances[3]).toEqual({
      speaker_label: "C",
      start_ms: 0,
      end_ms: 15000,
      text: "Missing start time.",
    });
    // Missing speaker only.
    expect(result.utterances[4]).toEqual({
      speaker_label: "Unknown",
      start_ms: 16000,
      end_ms: 17000,
      text: "Anonymous remark.",
    });
  });

  it("returns language, durationSeconds, and the raw transcript verbatim", async () => {
    stubAssemblyAiFetch();
    const result = await makeProvider().transcribe({
      kind: "url",
      url: "https://example.com/audio.wav",
    });

    expect(result.language).toBe("en_us");
    expect(result.durationSeconds).toBe(1860);
    expect(result.rawJson).toEqual(COMPLETED_TRANSCRIPT);
  });

  it("defaults language to 'en' and durationSeconds to null when absent", async () => {
    stubAssemblyAiFetch({
      id: TRANSCRIPT_ID,
      status: "completed",
      language_code: null,
      utterances: null, // null utterances -> empty array, not a crash
    });
    const result = await makeProvider().transcribe({
      kind: "url",
      url: "https://example.com/audio.wav",
    });

    expect(result.language).toBe("en");
    expect(result.durationSeconds).toBeNull();
    expect(result.utterances).toEqual([]);
  });

  it("bytes source: uploads first with auth header, then creates transcript from upload_url", async () => {
    const calls = stubAssemblyAiFetch();
    await makeProvider().transcribe({
      kind: "bytes",
      data: Buffer.from("fake audio bytes"),
      contentType: "audio/wav",
    });

    expect(calls).toHaveLength(3);
    const [upload, create, poll] = calls;

    expect(upload.url).toBe("https://api.assemblyai.com/v2/upload");
    expect(upload.method).toBe("POST");
    expect(upload.headers.authorization).toBe("test-aai-key");
    expect(upload.headers["content-type"]).toBe("application/octet-stream");

    expect(create.url).toBe("https://api.assemblyai.com/v2/transcript");
    expect(create.method).toBe("POST");
    expect(create.headers.authorization).toBe("test-aai-key");
    expect(create.body).toEqual({
      audio_url: UPLOAD_URL,
      speaker_labels: true,
    });

    expect(poll.url).toBe(
      `https://api.assemblyai.com/v2/transcript/${TRANSCRIPT_ID}`
    );
    expect(poll.method).toBe("GET");
  });

  it("url source: skips upload and passes the url straight through", async () => {
    const calls = stubAssemblyAiFetch();
    await makeProvider().transcribe({
      kind: "url",
      url: "https://example.com/council.mp3",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.assemblyai.com/v2/transcript");
    expect(calls[0].body).toEqual({
      audio_url: "https://example.com/council.mp3",
      speaker_labels: true,
    });
  });

  it("throws on transcript status 'error' with the provider's detail", async () => {
    stubAssemblyAiFetch({
      id: TRANSCRIPT_ID,
      status: "error",
      error: "Audio file is unreadable",
    });

    await expect(
      makeProvider().transcribe({
        kind: "url",
        url: "https://example.com/audio.wav",
      })
    ).rejects.toThrow(/Audio file is unreadable/);
  });

  it("throws on upload HTTP failure with the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upload exploded", { status: 502 }))
    );

    await expect(
      makeProvider().transcribe({
        kind: "bytes",
        data: Buffer.from("x"),
        contentType: "audio/wav",
      })
    ).rejects.toThrow(/HTTP 502/);
  });

  it("fails fast with a clear message when the API key is missing — no fetch", async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const provider = new AssemblyAiTranscriptionProvider(
      testConfig({ assemblyAiApiKey: null })
    );
    await expect(
      provider.transcribe({ kind: "url", url: "https://example.com/a.wav" })
    ).rejects.toThrow(/ASSEMBLYAI_API_KEY/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
