# Caption Fast Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For stream-source meetings, fetch an existing caption track before downloading audio, building the transcript from captions and skipping AssemblyAI when a track exists; fall back to today's audio-transcription path otherwise.

**Architecture:** A new `fetchCaptions` method on `StreamIngestProvider` runs first in the capture stage's stream branch. On a hit, the transcript+utterances are persisted immediately (flagged `diarized=false`) and the transcribe stage no-ops. On a miss it falls back to `extractAudio` → AssemblyAI unchanged. A single `transcripts.diarized` boolean drives the transcribe short-circuit, speaker-less summarization, and a UI badge.

**Tech Stack:** Next.js 15 + TypeScript, Vitest, Playwright, yt-dlp (shell-out), AssemblyAI, Anthropic, Supabase/in-memory store.

**Spec:** `docs/superpowers/specs/2026-06-13-caption-fast-lane-design.md`

**Commands:** `npm run test` (Vitest), `npm run typecheck`, `npm run lint`, `npm run test:e2e` (Playwright). Test files live in `tests/`. yt-dlp is NOT installed on this machine, so the real caption fetch can only be exercised via typecheck + its pure, no-spawn branches; all behavioral tests run against the mock provider.

---

## Task 1: Config keys for the caption fast lane

**Files:**
- Modify: `src/lib/config.ts`
- Test: `tests/config.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

const KEYS = ["CAPTION_FASTLANE", "CAPTION_LANGS", "CAPTION_FETCH_TIMEOUT_MS"];

describe("caption config", () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("defaults: enabled, en-first langs, 60s timeout", () => {
    for (const k of KEYS) delete process.env[k];
    const c = getConfig();
    expect(c.captionFastLane).toBe(true);
    expect(c.captionLangs).toEqual(["en", "en-US", "en-GB", "en-orig"]);
    expect(c.captionFetchTimeoutMs).toBe(60000);
  });

  it("honors env overrides", () => {
    process.env.CAPTION_FASTLANE = "false";
    process.env.CAPTION_LANGS = "es, fr";
    process.env.CAPTION_FETCH_TIMEOUT_MS = "12000";
    const c = getConfig();
    expect(c.captionFastLane).toBe(false);
    expect(c.captionLangs).toEqual(["es", "fr"]);
    expect(c.captionFetchTimeoutMs).toBe(12000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL, `captionFastLane` is undefined on the config object.

- [ ] **Step 3: Implement**

In `src/lib/config.ts`, add to the `AppConfig` interface (after `dataDir`):

```typescript
  /** Try fetching an existing caption track before downloading audio (stream sources). */
  captionFastLane: boolean;
  /** Caption language preference order (manual beats auto within the first match). */
  captionLangs: string[];
  /** Hard timeout for a caption fetch before falling back to audio. */
  captionFetchTimeoutMs: number;
```

In `getConfig()`'s returned object (after `dataDir: ...,`):

```typescript
    captionFastLane: (env("CAPTION_FASTLANE") ?? "true") !== "false",
    captionLangs: (env("CAPTION_LANGS") ?? "en,en-US,en-GB,en-orig")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    captionFetchTimeoutMs: Number(env("CAPTION_FETCH_TIMEOUT_MS") ?? "60000"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/config.test.ts
git commit -m "Add caption fast-lane config (flag, langs, timeout)"
```

---

## Task 2: `diarized` flag on transcripts (type, stores, migration)

**Files:**
- Modify: `src/lib/types.ts` (`Transcript`)
- Modify: `src/lib/store/types.ts` (`createTranscript` input)
- Modify: `src/lib/store/memory.ts` (createTranscript + transcript reads)
- Modify: `src/lib/store/supabase.ts` (createTranscript + transcript mapping)
- Create: `supabase/migrations/0002_transcript_diarized.sql`
- Test: `tests/transcript-diarized.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/transcript-diarized.test.ts
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store/memory";

async function freshStore() {
  const store = new MemoryStore({ dataDir: null }); // in-memory only, no disk
  const meeting = await store.createMeeting({
    title: "T",
    body_name: "City Council",
    source_type: "stream",
    source_url: "https://example.com/v",
  });
  return { store, meeting };
}

describe("transcripts.diarized", () => {
  it("defaults to true when not specified", async () => {
    const { store, meeting } = await freshStore();
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
    });
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(true);
  });

  it("persists diarized=false for caption transcripts", async () => {
    const { store, meeting } = await freshStore();
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
      diarized: false,
    });
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(false);
  });
});
```

> NOTE: Confirm `MemoryStore`'s constructor signature first by reading `src/lib/store/memory.ts`. If it takes a different shape (e.g. `new MemoryStore(dataDir?)`), adjust `freshStore()` accordingly to match the existing unit tests in `tests/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transcript-diarized.test.ts`
Expected: FAIL, `createTranscript` rejects the `diarized` field / `t.diarized` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, add to `Transcript`:

```typescript
export interface Transcript {
  id: string;
  meeting_id: string;
  raw_json: unknown;
  language: string;
  /** True for audio transcription (AssemblyAI/mock, has speaker labels);
   *  false for caption-sourced transcripts (no diarization). */
  diarized: boolean;
  created_at: string;
}
```

In `src/lib/store/types.ts`, extend the `createTranscript` input:

```typescript
  createTranscript(input: {
    meeting_id: string;
    raw_json: unknown;
    language: string;
    /** Defaults to true (audio transcription). Caption transcripts pass false. */
    diarized?: boolean;
  }): Promise<Transcript>;
```

In `src/lib/store/memory.ts` `createTranscript`: when constructing the stored transcript record, set `diarized: input.diarized ?? true`. In every place a stored transcript row is returned/mapped to a `Transcript`, coerce legacy rows: `diarized: row.diarized ?? true`. (Search the file for `language:` in transcript construction/return sites.)

In `src/lib/store/supabase.ts`: include `diarized: input.diarized ?? true` in the insert payload, and map `diarized: row.diarized ?? true` wherever a DB row becomes a `Transcript`.

Create `supabase/migrations/0002_transcript_diarized.sql`:

```sql
-- Mark how a transcript was produced. Audio transcription (AssemblyAI) is
-- diarized; caption-sourced transcripts (caption fast lane) are not.
alter table transcripts
  add column diarized boolean not null default true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transcript-diarized.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full test sweep, then commit**

```bash
npm run typecheck
npx vitest run
git add src/lib/types.ts src/lib/store/types.ts src/lib/store/memory.ts src/lib/store/supabase.ts supabase/migrations/0002_transcript_diarized.sql tests/transcript-diarized.test.ts
git commit -m "Add transcripts.diarized flag (default true) through types, stores, migration"
```

---

## Task 3: Caption parser + fixtures

**Files:**
- Create: `src/lib/captions/parse.ts`
- Create: `src/lib/fixtures/captions.ts`
- Test: `tests/captions-parse.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/captions-parse.test.ts
import { describe, expect, it } from "vitest";
import {
  parseJson3,
  parseVtt,
  cuesToUtterances,
  captionResultFromCues,
} from "@/lib/captions/parse";

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Good " }, { utf8: "evening." }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "\n" }] }, // whitespace only -> dropped
    { tStartMs: 2000, dDurationMs: 3000, segs: [{ utf8: "Meeting called to order." }] },
    { tStartMs: 5000, dDurationMs: 1000 }, // no segs -> dropped
  ],
});

const VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
Good evening.

00:00:02.000 --> 00:00:05.000
Meeting <c>called</c> to order.
`;

describe("parseJson3", () => {
  it("extracts non-empty cues with timing", () => {
    const cues = parseJson3(JSON3);
    expect(cues).toEqual([
      { startMs: 0, endMs: 2000, text: "Good evening." },
      { startMs: 2000, endMs: 5000, text: "Meeting called to order." },
    ]);
  });

  it("returns [] for malformed input", () => {
    expect(parseJson3("not json")).toEqual([]);
    expect(parseJson3(JSON.stringify({ foo: 1 }))).toEqual([]);
  });
});

describe("parseVtt", () => {
  it("extracts cues and strips tags", () => {
    const cues = parseVtt(VTT);
    expect(cues).toEqual([
      { startMs: 0, endMs: 2000, text: "Good evening." },
      { startMs: 2000, endMs: 5000, text: "Meeting called to order." },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseVtt("")).toEqual([]);
  });
});

describe("cuesToUtterances", () => {
  it("labels every utterance CAPTION and collapses consecutive duplicates", () => {
    const us = cuesToUtterances([
      { startMs: 0, endMs: 1000, text: "Hello" },
      { startMs: 1000, endMs: 2000, text: "Hello" },
      { startMs: 2000, endMs: 3000, text: "World" },
    ]);
    expect(us).toEqual([
      { speaker_label: "CAPTION", start_ms: 0, end_ms: 2000, text: "Hello" },
      { speaker_label: "CAPTION", start_ms: 2000, end_ms: 3000, text: "World" },
    ]);
  });
});

describe("captionResultFromCues", () => {
  it("builds a non-empty TranscriptionResult with duration from the last cue", () => {
    const r = captionResultFromCues(
      [{ startMs: 0, endMs: 4000, text: "Hi" }],
      "en"
    );
    expect(r).not.toBeNull();
    expect(r!.utterances).toHaveLength(1);
    expect(r!.durationSeconds).toBe(4);
    expect(r!.language).toBe("en");
  });

  it("returns null when there are no usable cues", () => {
    expect(captionResultFromCues([], "en")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/captions-parse.test.ts`
Expected: FAIL, module `@/lib/captions/parse` not found.

- [ ] **Step 3: Implement the parser**

```typescript
// src/lib/captions/parse.ts
// Pure parsing of caption tracks (YouTube json3 + WebVTT) into the
// DiarizedUtterance shape used by the rest of the pipeline. Caption tracks
// carry no speaker information, so every utterance is labelled "CAPTION".
// Any parse failure yields [] (the caller falls back to audio transcription).

import type {
  DiarizedUtterance,
  TranscriptionResult,
} from "@/lib/providers/types";

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Sentinel speaker label for caption (non-diarized) utterances. */
export const CAPTION_SPEAKER_LABEL = "CAPTION";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Parse YouTube's json3 caption format. Returns [] on any failure. */
export function parseJson3(raw: string): CaptionCue[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = (doc as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const cues: CaptionCue[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as {
      tStartMs?: unknown;
      dDurationMs?: unknown;
      segs?: unknown;
    };
    if (typeof e.tStartMs !== "number" || !Array.isArray(e.segs)) continue;
    const text = clean(
      e.segs
        .map((s) =>
          s && typeof s === "object" && typeof (s as { utf8?: unknown }).utf8 === "string"
            ? (s as { utf8: string }).utf8
            : ""
        )
        .join("")
    );
    if (text.length === 0) continue;
    const startMs = e.tStartMs;
    const endMs = startMs + (typeof e.dDurationMs === "number" ? e.dDurationMs : 0);
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

const VTT_TIME = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(ms)
  );
}

/** Parse WebVTT. Returns [] on any failure. */
export function parseVtt(raw: string): CaptionCue[] {
  if (!raw || raw.trim().length === 0) return [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cues: CaptionCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(VTT_TIME);
    if (!m) {
      i += 1;
      continue;
    }
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !VTT_TIME.test(lines[i])) {
      textLines.push(lines[i]);
      i += 1;
    }
    const text = clean(textLines.join(" ").replace(/<[^>]+>/g, ""));
    if (text.length > 0) cues.push({ startMs, endMs, text });
  }
  return cues;
}

/** Map cues to utterances, collapsing consecutive exact-duplicate text
 *  (common in rolling auto-captions) by extending the previous cue's end. */
export function cuesToUtterances(cues: CaptionCue[]): DiarizedUtterance[] {
  const out: DiarizedUtterance[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.text === cue.text) {
      prev.end_ms = Math.max(prev.end_ms, cue.endMs);
      continue;
    }
    out.push({
      speaker_label: CAPTION_SPEAKER_LABEL,
      start_ms: cue.startMs,
      end_ms: cue.endMs,
      text: cue.text,
    });
  }
  return out;
}

/** Build a TranscriptionResult from cues, or null if there are no usable cues. */
export function captionResultFromCues(
  cues: CaptionCue[],
  language: string
): TranscriptionResult | null {
  const utterances = cuesToUtterances(cues);
  if (utterances.length === 0) return null;
  const last = utterances[utterances.length - 1];
  return {
    rawJson: { source: "captions", language, cues },
    language,
    durationSeconds: Math.round(last.end_ms / 1000),
    utterances,
  };
}
```

- [ ] **Step 4: Create the fixture**

```typescript
// src/lib/fixtures/captions.ts
// Deterministic caption fixture used by the mock stream provider and tests.

import { captionResultFromCues, type CaptionCue } from "@/lib/captions/parse";
import type { TranscriptionResult } from "@/lib/providers/types";

export const FIXTURE_CAPTION_CUES: CaptionCue[] = [
  { startMs: 0, endMs: 4000, text: "Good evening and welcome to the regular meeting of the City Council." },
  { startMs: 4000, endMs: 9000, text: "The first item on the agenda is the proposed parks budget for next year." },
  { startMs: 9000, endMs: 15000, text: "After discussion, the council voted four to one to approve the budget as presented." },
  { startMs: 15000, endMs: 20000, text: "The meeting was adjourned at eight fifteen p.m." },
];

export function buildFixtureCaptionResult(): TranscriptionResult {
  // Non-null by construction (fixture has cues).
  return captionResultFromCues(FIXTURE_CAPTION_CUES, "en")!;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/captions-parse.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/captions/parse.ts src/lib/fixtures/captions.ts tests/captions-parse.test.ts
git commit -m "Add caption parser (json3 + vtt) and caption fixture"
```

---

## Task 4: `fetchCaptions` on the provider interface (real + mock)

**Files:**
- Modify: `src/lib/providers/types.ts` (interface + `SummaryInput`)
- Modify: `src/lib/providers/real/ytdlp.ts` (implement `fetchCaptions`, take config)
- Modify: `src/lib/providers/real/index.ts` (pass config to provider)
- Modify: `src/lib/providers/mock/stream.ts` (implement `fetchCaptions`)
- Test: `tests/caption-providers.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/caption-providers.test.ts
import { describe, expect, it } from "vitest";
import { MockStreamIngestProvider } from "@/lib/providers/mock/stream";
import { YtDlpStreamIngestProvider } from "@/lib/providers/real/ytdlp";
import { getConfig } from "@/lib/config";

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
    const config = { ...getConfig(), captionFastLane: false };
    const p = new YtDlpStreamIngestProvider(config);
    const r = await p.fetchCaptions("https://youtube.com/watch?v=abc");
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/caption-providers.test.ts`
Expected: FAIL, `fetchCaptions` not a function / `YtDlpStreamIngestProvider` constructor takes no args.

- [ ] **Step 3: Extend the interface**

In `src/lib/providers/types.ts`, add to `StreamIngestProvider`:

```typescript
export interface StreamIngestProvider {
  /** Try to fetch an existing caption track for the URL. Returns a
   *  (non-diarized) transcript on success, or null when no track exists / the
   *  fast lane is disabled / fetching fails; the caller then falls back to
   *  extractAudio. MUST NOT throw for the "no captions" case. */
  fetchCaptions(streamUrl: string): Promise<TranscriptionResult | null>;
  /** Extract audio from a public stream/video URL. Returns audio bytes. */
  extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }>;
}
```

And add the optional `diarized` flag to `SummaryInput`:

```typescript
export interface SummaryInput {
  meetingTitle: string;
  bodyName: string;
  /** Defaults to true. When false, the transcript has no speaker labels
   *  (caption fast lane) and is formatted without "Speaker:" prefixes. */
  diarized?: boolean;
  utterances: Array<{ speaker: string; text: string }>;
}
```

- [ ] **Step 4: Implement the mock**

```typescript
// src/lib/providers/mock/stream.ts
// Mock yt-dlp stream ingest provider. Returns a synthesized WAV instantly, and
// a fixture caption transcript from fetchCaptions (unless the URL opts out).

import { synthesizeWav } from "@/lib/fixtures/audio";
import { buildFixtureCaptionResult } from "@/lib/fixtures/captions";
import type {
  StreamIngestProvider,
  TranscriptionResult,
} from "@/lib/providers/types";

const MOCK_STREAM_SECONDS = 120;

export class MockStreamIngestProvider implements StreamIngestProvider {
  async fetchCaptions(streamUrl: string): Promise<TranscriptionResult | null> {
    // A URL containing "nocaptions" exercises the audio fallback path.
    if (streamUrl.includes("nocaptions")) return null;
    return buildFixtureCaptionResult();
  }

  async extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }> {
    void streamUrl; // every URL yields the same deterministic synthetic audio
    return {
      data: synthesizeWav(MOCK_STREAM_SECONDS),
      contentType: "audio/wav",
      durationSeconds: MOCK_STREAM_SECONDS,
    };
  }
}
```

- [ ] **Step 5: Implement the real provider**

In `src/lib/providers/real/ytdlp.ts`: import config + parser, add a constructor, and add `fetchCaptions`. Add these imports at the top:

```typescript
import { writeFile } from "node:fs/promises"; // (only if needed; otherwise omit)
import type { AppConfig } from "@/lib/config";
import {
  captionResultFromCues,
  parseJson3,
  parseVtt,
  type CaptionCue,
} from "@/lib/captions/parse";
import type {
  StreamIngestProvider,
  TranscriptionResult,
} from "@/lib/providers/types";
```

Add a spawn helper that captures stdout and supports a timeout (place near `runYtDlp`):

```typescript
/** Run yt-dlp, resolving with collected stdout. Kills the child after
 *  timeoutMs. Rejects on spawn error or non-zero exit. */
function runYtDlpCapture(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp caption fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code ?? "?"}: ${tail(stderr)}`));
    });
  });
}
```

Change the class declaration and add the constructor + method:

```typescript
export class YtDlpStreamIngestProvider implements StreamIngestProvider {
  constructor(private readonly config: AppConfig) {}

  async fetchCaptions(streamUrl: string): Promise<TranscriptionResult | null> {
    if (!this.config.captionFastLane) return null;
    const binary = process.env.YTDLP_PATH?.trim() || "yt-dlp";
    const langs = this.config.captionLangs.join(",");

    // Print the chosen subtitle track to stdout as json3 without downloading
    // media. --write-subs prefers manual subs; --write-auto-subs adds ASR.
    const args = [
      "--skip-download",
      "--no-playlist",
      "--no-progress",
      "--write-subs",
      "--write-auto-subs",
      "--sub-format",
      "json3/vtt/best",
      "--sub-langs",
      langs,
      // Emit the subtitle file contents to stdout.
      "--print-to-file",
      "subtitles",
      "-", // not portable across versions; see fallback note below
      "--",
      streamUrl,
    ];

    let raw: string;
    try {
      raw = await runYtDlpCapture(binary, args, this.config.captionFetchTimeoutMs);
    } catch {
      // No track, yt-dlp missing, timeout, or any other failure -> fall back.
      return null;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const cues: CaptionCue[] = trimmed.startsWith("{")
      ? parseJson3(trimmed)
      : parseVtt(trimmed);
    return captionResultFromCues(cues, this.config.captionLangs[0] ?? "en");
  }

  async extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }> {
    // ...UNCHANGED existing body...
  }
}
```

> IMPLEMENTATION NOTE (resolve during build, cannot be tested locally, yt-dlp absent): the exact mechanism for getting subtitle text to stdout varies by yt-dlp version. The robust approach is to write subs into a temp dir (mirroring `extractAudio`: `--sub-format json3 -o <tmpl> --skip-download`), then `readdir` the temp dir for the first `*.json3`/`*.vtt` file, `readFile` it, parse, and `rm` the temp dir in a `finally`. Prefer that temp-dir approach over `--print-to-file` if uncertain; keep the timeout via `runYtDlpCapture` (or wrap the existing `runYtDlp` with the same `setTimeout`/`child.kill`). Either way: on ANY failure return `null`, and route the parsed cues through `captionResultFromCues`. The behavioral guarantees (disabled → null without spawning; success → non-diarized TranscriptionResult) are what the tests pin; the spawn details are an internal of this method.

Update `src/lib/providers/real/index.ts` line 17:

```typescript
    streamIngest: new YtDlpStreamIngestProvider(config),
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/caption-providers.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/providers/types.ts src/lib/providers/real/ytdlp.ts src/lib/providers/real/index.ts src/lib/providers/mock/stream.ts tests/caption-providers.test.ts
git commit -m "Add fetchCaptions to StreamIngestProvider (real yt-dlp + mock)"
```

---

## Task 5: Shared `persistTranscription` helper + transcribe short-circuit

**Files:**
- Create: `src/lib/jobs/persist-transcript.ts`
- Modify: `src/lib/jobs/stages/transcribe.ts`
- Test: `tests/transcribe-shortcircuit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/transcribe-shortcircuit.test.ts
import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
import { LocalFileStorage } from "@/lib/store/memory"; // adjust import if FileStorage lives elsewhere
import { handleTranscribe } from "@/lib/jobs/stages/transcribe";
import type { Providers } from "@/lib/providers/types";

function providersWithSpyTranscription() {
  const transcribe = vi.fn();
  const providers = {
    transcription: { transcribe },
  } as unknown as Providers;
  return { providers, transcribe };
}

describe("handleTranscribe short-circuit", () => {
  it("no-ops when captions already produced a transcript (no audio)", async () => {
    const store = new MemoryStore({ dataDir: null });
    const files = new LocalFileStorage(null);
    const meeting = await store.createMeeting({
      title: "T",
      body_name: "City Council",
      source_type: "stream",
      source_url: "https://x/v",
    });
    // Caption fast lane already persisted a transcript; no audio_storage_path.
    await store.createTranscript({
      meeting_id: meeting.id,
      raw_json: {},
      language: "en",
      diarized: false,
    });
    const { providers, transcribe } = providersWithSpyTranscription();
    const job = await store.enqueueJob(meeting.id, "transcribe");

    await handleTranscribe(job, store, files, providers);

    expect(transcribe).not.toHaveBeenCalled();
  });
});
```

> NOTE: Confirm `LocalFileStorage`'s real export path/constructor from `src/lib/store/`. The existing test suite already constructs a store + file storage for pipeline tests; copy that exact setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transcribe-shortcircuit.test.ts`
Expected: FAIL, `transcribe` IS called (no short-circuit yet), or import error.

- [ ] **Step 3: Extract the persist helper**

```typescript
// src/lib/jobs/persist-transcript.ts
// Persist a TranscriptionResult (transcript row + utterances + speaker-alias
// application + duration backfill). Shared by the audio path (transcribe stage)
// and the caption fast lane (capture stage) so both persist identically.

import type { Meeting } from "@/lib/types";
import type { DataStore } from "@/lib/store/types";
import type { TranscriptionResult } from "@/lib/providers/types";

export async function persistTranscription(
  store: DataStore,
  meeting: Meeting,
  result: TranscriptionResult,
  opts: { diarized: boolean }
): Promise<void> {
  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: result.rawJson,
    language: result.language,
    diarized: opts.diarized,
  });

  await store.createUtterances(
    transcript.id,
    result.utterances.map((u) => ({
      speaker_label: u.speaker_label,
      start_ms: u.start_ms,
      end_ms: u.end_ms,
      text: u.text,
    }))
  );

  // Apply stored speaker aliases for this body (no-op for caption transcripts,
  // whose single "CAPTION" label never matches a real alias pattern).
  const aliases = await store.listSpeakerAliases(meeting.body_name);
  if (aliases.length > 0) {
    const labels = new Set(result.utterances.map((u) => u.speaker_label));
    for (const alias of aliases) {
      if (labels.has(alias.speaker_label_pattern)) {
        await store.applySpeakerNameToLabel(
          transcript.id,
          alias.speaker_label_pattern,
          alias.display_name
        );
      }
    }
  }

  if (result.durationSeconds != null && meeting.duration_seconds == null) {
    await store.updateMeeting(meeting.id, {
      duration_seconds: Math.round(result.durationSeconds),
    });
  }
}
```

- [ ] **Step 4: Rewrite the transcribe stage**

Replace the body of `handleTranscribe` in `src/lib/jobs/stages/transcribe.ts` (keep the file's top comment, update it). New imports: `import { persistTranscription } from "@/lib/jobs/persist-transcript";`. Remove the now-unused alias/createTranscript/createUtterances logic (moved into the helper).

```typescript
export async function handleTranscribe(
  job: Job,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  const meeting = await store.getMeeting(job.meeting_id);
  if (!meeting) {
    throw new Error(`Meeting ${job.meeting_id} not found`);
  }

  await store.setMeetingStatus(meeting.id, "transcribing");

  // Caption fast lane: the capture stage already produced the transcript and
  // left no audio to transcribe. Nothing to do; the runner enqueues summarize.
  if (!meeting.audio_storage_path) {
    const existing = await store.getTranscriptByMeeting(meeting.id);
    if (existing) return;
    throw new Error(
      `Meeting ${meeting.id} has no audio_storage_path: capture must run first`
    );
  }

  const audio = await files.get(meeting.audio_storage_path);
  if (!audio) {
    throw new Error(
      `Audio file missing from storage: ${meeting.audio_storage_path}`
    );
  }

  const result = await providers.transcription.transcribe({
    kind: "bytes",
    data: audio.data,
    contentType: audio.contentType,
  });

  await persistTranscription(store, meeting, result, { diarized: true });
}
```

- [ ] **Step 5: Run tests + typecheck + full sweep**

Run: `npx vitest run tests/transcribe-shortcircuit.test.ts && npm run typecheck && npx vitest run`
Expected: PASS; the existing transcribe/alias unit tests still pass (helper preserves behavior).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/persist-transcript.ts src/lib/jobs/stages/transcribe.ts tests/transcribe-shortcircuit.test.ts
git commit -m "Extract persistTranscription helper; short-circuit transcribe for caption transcripts"
```

---

## Task 6: Capture stage: caption-first stream branch

**Files:**
- Modify: `src/lib/jobs/stages/capture.ts` (`captureStream`)
- Test: `tests/capture-captions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/capture-captions.test.ts
import { describe, expect, it, vi } from "vitest";
import { MemoryStore, LocalFileStorage } from "@/lib/store/memory"; // adjust to real paths
import { handleCapture } from "@/lib/jobs/stages/capture";
import type { Providers } from "@/lib/providers/types";
import { buildFixtureCaptionResult } from "@/lib/fixtures/captions";

function makeProviders(over: Partial<Providers["streamIngest"]>): Providers {
  return {
    streamIngest: {
      fetchCaptions: vi.fn().mockResolvedValue(null),
      extractAudio: vi.fn().mockResolvedValue({
        data: Buffer.from("x"),
        contentType: "audio/wav",
        durationSeconds: 120,
      }),
      ...over,
    },
  } as unknown as Providers;
}

async function streamMeeting(store: MemoryStore) {
  return store.createMeeting({
    title: "T",
    body_name: "City Council",
    source_type: "stream",
    source_url: "https://x/v",
  });
}

describe("captureStream caption fast lane", () => {
  it("persists a caption transcript and skips audio when captions exist", async () => {
    const store = new MemoryStore({ dataDir: null });
    const files = new LocalFileStorage(null);
    const meeting = await streamMeeting(store);
    const extractAudio = vi.fn();
    const providers = makeProviders({
      fetchCaptions: vi.fn().mockResolvedValue(buildFixtureCaptionResult()),
      extractAudio,
    });
    const job = await store.enqueueJob(meeting.id, "capture");

    await handleCapture(job, store, files, providers);

    expect(extractAudio).not.toHaveBeenCalled();
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t?.diarized).toBe(false);
    const after = await store.getMeeting(meeting.id);
    expect(after?.audio_storage_path).toBeNull();
  });

  it("falls back to extractAudio when there are no captions", async () => {
    const store = new MemoryStore({ dataDir: null });
    const files = new LocalFileStorage(null);
    const meeting = await streamMeeting(store);
    const extractAudio = vi.fn().mockResolvedValue({
      data: Buffer.from("x"),
      contentType: "audio/wav",
      durationSeconds: 120,
    });
    const providers = makeProviders({
      fetchCaptions: vi.fn().mockResolvedValue(null),
      extractAudio,
    });
    const job = await store.enqueueJob(meeting.id, "capture");

    await handleCapture(job, store, files, providers);

    expect(extractAudio).toHaveBeenCalledTimes(1);
    const t = await store.getTranscriptByMeeting(meeting.id);
    expect(t).toBeNull();
    const after = await store.getMeeting(meeting.id);
    expect(after?.audio_storage_path).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capture-captions.test.ts`
Expected: FAIL, `fetchCaptions` not consulted; transcript never created.

- [ ] **Step 3: Implement the caption-first branch**

In `src/lib/jobs/stages/capture.ts`, add the import:

```typescript
import { persistTranscription } from "@/lib/jobs/persist-transcript";
```

Replace `captureStream` with:

```typescript
async function captureStream(
  meeting: Meeting,
  store: DataStore,
  files: FileStorage,
  providers: Providers
): Promise<void> {
  if (!meeting.source_url) {
    throw new Error(`Stream meeting ${meeting.id} has no source_url`);
  }

  await store.setMeetingStatus(meeting.id, "capturing");

  // Fast lane: if the source has an existing caption track, build the
  // transcript from it and skip both the audio download and AssemblyAI.
  // fetchCaptions never throws for the "no captions" case; a null result
  // (no track / disabled / fetch failed) falls through to audio extraction.
  const captions = await providers.streamIngest.fetchCaptions(meeting.source_url);
  if (captions) {
    await persistTranscription(store, meeting, captions, { diarized: false });
    return; // no audio stored; transcribe stage will no-op
  }

  const { data, contentType, durationSeconds } =
    await providers.streamIngest.extractAudio(meeting.source_url);

  const path = audioPathFor(meeting.id, contentType);
  await files.put(path, data, contentType);
  await store.updateMeeting(meeting.id, {
    audio_storage_path: path,
    ...(durationSeconds != null
      ? { duration_seconds: Math.round(durationSeconds) }
      : {}),
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/capture-captions.test.ts && npm run typecheck`
Expected: PASS both cases; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/stages/capture.ts tests/capture-captions.test.ts
git commit -m "Capture: fetch captions before audio for stream sources"
```

---

## Task 7: Speaker-less summarization

**Files:**
- Modify: `src/lib/jobs/stages/summarize.ts` (pass `diarized`)
- Modify: `src/lib/providers/real/anthropic.ts` (`buildUserContent`)
- Test: `tests/summary-prompt.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`buildUserContent` is currently a module-private function. Export it for testing (add `export` to its declaration in `anthropic.ts`).

```typescript
// tests/summary-prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildUserContent } from "@/lib/providers/real/anthropic";

const base = {
  meetingTitle: "Council Meeting",
  bodyName: "City Council",
  utterances: [
    { speaker: "Speaker A", text: "Good evening." },
    { speaker: "Speaker B", text: "Motion to approve." },
  ],
};

describe("buildUserContent", () => {
  it("uses Speaker: prefixes when diarized (default)", () => {
    const out = buildUserContent(base);
    expect(out).toContain("Diarized transcript:");
    expect(out).toContain("Speaker A: Good evening.");
  });

  it("omits speaker prefixes when not diarized", () => {
    const out = buildUserContent({ ...base, diarized: false });
    expect(out).toContain("Transcript (auto-captions, no speaker labels):");
    expect(out).not.toContain("Speaker A:");
    expect(out).toContain("Good evening.");
    expect(out).toContain("Motion to approve.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/summary-prompt.test.ts`
Expected: FAIL, `buildUserContent` not exported / non-diarized branch missing.

- [ ] **Step 3: Implement**

In `src/lib/providers/real/anthropic.ts`, replace `buildUserContent`:

```typescript
export function buildUserContent(input: SummaryInput): string {
  const diarized = input.diarized ?? true;
  const transcript = diarized
    ? input.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
    : input.utterances.map((u) => u.text).join("\n");
  return [
    `Meeting title: ${input.meetingTitle}`,
    `Public body: ${input.bodyName}`,
    "",
    diarized
      ? "Diarized transcript:"
      : "Transcript (auto-captions, no speaker labels):",
    transcript,
  ].join("\n");
}
```

In `src/lib/jobs/stages/summarize.ts`, thread the flag. Replace the `summarize` call:

```typescript
  const content = await providers.summary.summarize({
    meetingTitle: meeting.title,
    bodyName: meeting.body_name,
    diarized: transcript.diarized,
    utterances: utterances.map((u) => ({
      speaker: u.speaker_name ?? `Speaker ${u.speaker_label}`,
      text: u.text,
    })),
  });
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/summary-prompt.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/real/anthropic.ts src/lib/jobs/stages/summarize.ts tests/summary-prompt.test.ts
git commit -m "Summarize caption transcripts without speaker labels"
```

---

## Task 8: UI: caption badge + plain transcript rendering

**Files:**
- Modify: `src/components/meeting/TranscriptList.tsx` (add `diarized` prop)
- Modify: `src/components/meeting/MeetingView.tsx` (badge + pass `diarized`)
- Test: manual (Playwright covers it in Task 9)

- [ ] **Step 1: Add a `diarized` prop to `TranscriptList`**

In `TranscriptListProps` add `diarized: boolean;`. In the row render, branch: when `!diarized`, render timestamp as plain (non-interactive) text and omit `<SpeakerName>`; when diarized, keep today's markup. Replace the header `<div className="flex flex-wrap ...">` block and the row body:

```tsx
              {diarized ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                  <button
                    type="button"
                    onClick={() => onSeek(utterance.start_ms)}
                    aria-label={`Play audio from ${formatTimestamp(utterance.start_ms)}`}
                    title="Play audio from here"
                    className="rounded font-mono text-base font-medium tabular-nums text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                  >
                    {formatTimestamp(utterance.start_ms)}
                  </button>
                  <SpeakerName
                    utteranceId={utterance.id}
                    speakerLabel={utterance.speaker_label}
                    displayName={displayName}
                    color={color}
                    onRename={onRename}
                  />
                </div>
              ) : (
                <div className="px-4 pt-3">
                  <span className="font-mono text-base font-medium tabular-nums text-slate-500">
                    {formatTimestamp(utterance.start_ms)}
                  </span>
                </div>
              )}
```

Guard the now-conditionally-used `color`/`displayName` so lint stays clean: compute them only in the diarized branch, or keep them and reference inside the branch (they already are). If ESLint flags `color`/`displayName` as unused when `!diarized`, move their `const` declarations inside the `diarized` branch.

- [ ] **Step 2: Pass `diarized` from `MeetingView` and show the badge**

In `MeetingView.tsx`, after `const hasTranscript = detail.utterances.length > 0;` add:

```tsx
  const diarized = detail.transcript?.diarized ?? true;
```

Pass it to `<TranscriptList ... diarized={diarized} />`. Under the `<h2 id="transcript-heading">Transcript</h2>`, add the badge when a transcript exists and it is not diarized:

```tsx
        {hasTranscript && !diarized && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
            From auto-captions, no speaker labels
          </p>
        )}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean. (`detail.transcript` is already part of `MeetingDetail`; the `diarized` field exists after Task 2.)

- [ ] **Step 4: Commit**

```bash
git add src/components/meeting/TranscriptList.tsx src/components/meeting/MeetingView.tsx
git commit -m "UI: caption badge and speaker-less transcript rendering"
```

---

## Task 9: End-to-end coverage (mock mode)

**Files:**
- Modify/Create: `tests/e2e/caption-fast-lane.spec.ts`
- Reference: existing `tests/e2e/civicscribe.spec.ts` for the submit→poll→assert pattern and helpers.

- [ ] **Step 1: Write the e2e spec**

Mirror the existing e2e flow (which already drives the worker via `/api/jobs/tick` or the dev worker; reuse whatever the current spec uses). Two cases:

```typescript
// tests/e2e/caption-fast-lane.spec.ts
import { test, expect } from "@playwright/test";

// Reuse the existing spec's helpers/setup for creating a stream meeting and
// driving job ticks. Pseudocode-level; adapt to the real helpers.

test("caption fast lane: stream URL with captions summarizes without speakers", async ({ page }) => {
  // create a stream meeting with a normal URL (mock fetchCaptions returns the fixture)
  // drive ticks until status === complete
  // assert the "From auto-captions, no speaker labels" badge is visible
  // assert no SpeakerName edit controls are present
  // assert a summary rendered
});

test("fallback: stream URL containing 'nocaptions' uses the audio path with speakers", async ({ page }) => {
  // create a stream meeting with a URL containing "nocaptions"
  // drive ticks until complete
  // assert the badge is NOT present and diarized transcript shows Speaker labels
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e -- caption-fast-lane`
Expected: both tests PASS in mock mode.

- [ ] **Step 3: Full gate sweep**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/caption-fast-lane.spec.ts
git commit -m "E2E: caption fast lane + audio fallback"
```

---

## Final verification (before declaring done)

- [ ] `npm run typecheck`: clean
- [ ] `npm run lint`: clean
- [ ] `npx vitest run`: all unit tests pass (49 existing + new)
- [ ] `npm run test:e2e`: all e2e pass
- [ ] `npm run build`: production build succeeds
- [ ] Manual mock-mode smoke: `npm run seed` + `npm run dev` + `npm run worker`, submit a stream URL, confirm the caption badge and an instant summary; submit a `…nocaptions…` URL, confirm the diarized fallback.

## Notes / risks carried from the spec

- yt-dlp is NOT installed here; the real `fetchCaptions` spawn path is verified only by typecheck and its disabled-returns-null branch. The temp-dir-vs-stdout detail in Task 4 Step 5 is an internal to finalize when yt-dlp is available; the tests pin behavior, not the spawn mechanism.
- `CAPTION_FASTLANE=false` is the kill switch if YouTube anti-scraping breaks fetching; auto-fallback means a caption miss never breaks a video that works today.
