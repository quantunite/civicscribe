# Caption Fast Lane: Design

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation
**Branch:** `feat/caption-fast-lane`

## Problem

CivicScribe turns a meeting video into a summary via `capture → transcribe →
summarize → notify`. For stream/URL sources (YouTube, municipal livestreams)
the slow steps are:

1. **Audio download**: `yt-dlp` extracts the full audio track.
2. **Transcription**: AssemblyAI uploads the audio and is polled every 3s for
   3–5 minutes (`src/lib/providers/real/assemblyai.ts`).

Yet many of these videos (notably YouTube) **already have a caption track**.
Tools like youtube-transcript.io feel instant precisely because they read the
existing captions instead of transcribing audio. CivicScribe re-transcribes
captions YouTube already produced, wasting minutes.

## Goal

For stream-source URLs, attempt to fetch an existing caption track first. When
one exists, build the transcript from it and skip both the audio download and
AssemblyAI, taking end-to-end latency from minutes to a few seconds. When no
caption track exists, fall back to today's audio-transcription path unchanged.

## Decisions (settled during brainstorming)

1. **Fast-first, auto-fallback.** Always try captions first for caption-bearing
   stream URLs. Accept speaker-blind summaries on the fast lane. Fall back to
   AssemblyAI only when no caption track is available.
2. **Scope: stream source type only.** Any `yt-dlp`-supported URL is eligible
   (YouTube, Vimeo, many municipal/Granicus pages) via the same command. Out of
   scope: uploaded `.srt`/`.vtt` files, Recall/Zoom transcript reuse, and the
   `upload`/`zoom` source types, which all keep today's behavior.
3. **Adding the fast lane can never break a video that works today.** Caption
   fetch is strictly best-effort; any failure falls back to audio.

## Non-Goals

- Speaker diarization on the caption path. YouTube auto-captions are an
  unattributed text stream; caption-sourced summaries are explicitly
  speaker-blind. (The audio path keeps AssemblyAI diarization.)
- Caption support for `upload` or `zoom` sources.
- A user-facing "fast vs full" toggle. The lane is automatic.

## Architecture

The caption attempt lives in the **capture stage, stream branch**, *before*
`extractAudio`, so the fast lane skips both the download and AssemblyAI.
Everything downstream of the branch is the existing pipeline.

```
stream URL → captureStream()
   │
   ├─ providers.streamIngest.fetchCaptions(url)        ← NEW, runs FIRST
   │      ├─ caption track found → persist transcript+utterances now
   │      │        (diarized=false), set duration                   →─┐
   │      └─ null (no track / disabled / error / timeout) ─┐          │
   │                                                        ▼          │
   └─ providers.streamIngest.extractAudio(url) → store audio (today)  │
                                                          │            │
   transcribe stage:  transcript already exists? ─────────┴─ yes → no-op ─┤
                      no → AssemblyAI as today ─────────────────────────────┤
                                                                            ▼
                                       summarize → notify  (unchanged graph)
```

The job stage graph (`capture → transcribe → summarize → notify`) and the job
state machine are **unchanged**. The transcribe stage becomes a no-op when a
transcript already exists, which also makes it idempotent on retry.

### Data-model signal: `diarized` on the transcript

Add `diarized: boolean` to the `Transcript` type and the `transcripts` table,
default `true`. The audio path (AssemblyAI/mock) writes `true`; the caption
path writes `false`. This single flag drives:

- **transcribe short-circuit**: actually keyed on "transcript already exists",
  but `diarized` is the persisted record of how it was produced;
- **summarize formatting**: drop the `Speaker:` prefix when `false`;
- **UI**: show the "auto-captions, no speaker labels" badge when `false`.

It lives on the transcript (not the meeting), so meeting-creation code is
untouched. Default `true` keeps every existing transcript and code path
behaving exactly as before.

## Components

### New files

- **`src/lib/captions/parse.ts`**: pure parsing. `parseJson3(raw)` and
  `parseVtt(raw)` produce an intermediate `CaptionCue[]` (`{ startMs, endMs,
  text }`); `cuesToUtterances(cues)` maps cues to `DiarizedUtterance[]` with a
  single sentinel `speaker_label` (`"CAPTION"`) and real timings. Adjacent
  fragments are merged into readable lines. Malformed/empty input yields `[]`.
  This is the main correctness risk and gets the heaviest unit tests.
- **`src/lib/jobs/persist-transcript.ts`**: `persistTranscription(store,
  meeting, result, { diarized })`. Extracted from `transcribe.ts` so the
  caption path (in capture) and the audio path (in transcribe) persist the
  transcript, utterances, speaker-alias application, and duration identically.
  Alias application is a no-op for caption transcripts (no real labels match).
- **`src/lib/fixtures/captions.ts`**: a small json3 fixture + a parsed
  `TranscriptionResult` fixture used by the mock provider and tests.

### Modified files

- **`src/lib/providers/types.ts`**
  - `StreamIngestProvider` gains `fetchCaptions(streamUrl: string):
    Promise<TranscriptionResult | null>`.
  - `SummaryInput` gains optional `diarized?: boolean` (default `true`).
- **`src/lib/providers/real/ytdlp.ts`**: implement `fetchCaptions`: run
  `yt-dlp --write-subs --write-auto-subs --sub-langs <pref> --sub-format json3
  --skip-download -o <tmpl> -- <url>` into a temp dir, prefer manual over
  auto-generated within the first matching language, read+parse the produced
  file, return a `TranscriptionResult` (`diarized` semantics carried by the
  caller) or `null` if no track / parse empty. Time-bounded; see Error Handling.
- **`src/lib/providers/mock/stream.ts`**: implement `fetchCaptions`: return the
  caption fixture by default; return `null` when the URL contains the substring
  `nocaptions`, so tests/e2e can drive both branches deterministically.
- **`src/lib/jobs/stages/capture.ts`**: `captureStream` tries `fetchCaptions`
  first (when `config.captionFastLane`); on a non-null result it calls
  `persistTranscription(..., { diarized: false })`, sets duration, and does
  **not** store audio; on `null` it falls through to today's `extractAudio`.
- **`src/lib/jobs/stages/transcribe.ts`**: short-circuit at the top: if
  `store.getTranscriptByMeeting(meeting.id)` returns a transcript, set status
  `transcribing` and return (runner enqueues summarize). Otherwise run the
  AssemblyAI path, now persisting via the shared `persistTranscription` helper
  with `{ diarized: true }`.
- **`src/lib/jobs/stages/summarize.ts`**: pass `diarized: transcript.diarized`
  into `SummaryInput`. For non-diarized transcripts, do not synthesize
  `Speaker ${label}` placeholders.
- **`src/lib/providers/real/anthropic.ts`**: `buildUserContent` branches on
  `input.diarized`: diarized → `Speaker: text` lines under "Diarized
  transcript:"; non-diarized → plain text lines under "Transcript
  (auto-captions, no speaker labels):".
- **`src/lib/config.ts`**: add `captionFastLane`, `captionLangs`,
  `captionFetchTimeoutMs` (see Config).
- **`src/lib/types.ts`**: `Transcript` gains `diarized: boolean`.
- **`src/lib/store/types.ts`**, **`memory.ts`**, **`supabase.ts`**: thread
  `diarized` through `createTranscript` (default `true` for back-compat).
- **`supabase/migrations/0002_transcript_diarized.sql`**: `alter table
  transcripts add column diarized boolean not null default true;`
- **UI**: `src/components/meeting/MeetingView.tsx`, `SummaryPanel.tsx`,
  `TranscriptList.tsx`: when `transcript.diarized === false`, show a
  "From auto-captions, no speaker labels" badge, render the transcript as plain
  flowing text, and hide speaker-naming affordances.

## Data Flow (caption hit)

1. `POST /api/meetings` creates a `stream` meeting (unchanged).
2. Capture job: `captureStream` → `fetchCaptions(url)` returns a
   `TranscriptionResult` → `persistTranscription(store, meeting, result,
   { diarized: false })` writes transcript (`diarized=false`) + utterances +
   duration. No audio stored. Status → `transcribing`.
3. Transcribe job: transcript already exists → no-op. Status stays
   `transcribing`; runner enqueues summarize.
4. Summarize job: reads transcript (`diarized=false`), builds a speaker-less
   prompt, persists the summary, status → `complete`. Notify as today.

## Error Handling / Fallback Rules

- `fetchCaptions` is best-effort and **never fails the job**. No track, yt-dlp
  error, network error, empty/garbage caption file (parses to zero cues), or
  fast-lane disabled → returns `null` → capture proceeds to `extractAudio`.
- **Time-bounded.** `fetchCaptions` is wrapped with a timeout
  (`captionFetchTimeoutMs`, default 60s); on timeout the child process is killed
  and it returns `null` → fallback. A caption fetch slower than transcription
  isn't worth it.
- Only a genuine failure of the audio fallback fails the meeting, exactly as
  today. The fast lane is purely additive.

## Config

In `AppConfig` / `getConfig()`:

- `captionFastLane: boolean`: env `CAPTION_FASTLANE`, default `true`. Kill
  switch; `false` makes capture behave exactly as today.
- `captionLangs: string[]`: env `CAPTION_LANGS` (comma-separated), default
  `["en","en-US","en-GB","en-orig"]`. Preference order; manual beats auto within
  the first matching language.
- `captionFetchTimeoutMs: number`: env `CAPTION_FETCH_TIMEOUT_MS`, default
  `60000`.

## Latency

Stream-with-captions: ~3–5 min → **a few seconds** (yt-dlp subtitle fetch + ~2s
Claude summary + one worker tick). Videos without captions: unchanged.

## Testing

### Unit (Vitest)

- `captions/parse.ts`: json3 + vtt fixtures incl. malformed/empty (→ `[]`),
  timing correctness, fragment merging. Heaviest coverage.
- `mock/stream.ts` `fetchCaptions`: captions fixture vs `nocaptions` → `null`.
- `capture.ts` stream branch: captions present → transcript persisted, **no**
  audio stored, `extractAudio` not called; captions absent → `extractAudio`
  called, no transcript pre-created.
- `transcribe.ts`: transcript already exists → short-circuit, transcription
  provider **not** called; no transcript → AssemblyAI path runs and persists
  `diarized=true`.
- `anthropic.ts` `buildUserContent`: `diarized=false` omits `Speaker:` prefixes
  and uses the captions header; `diarized=true` unchanged.
- `config.ts`: defaults + env overrides for the three new keys.

### E2E (Playwright, mock mode)

- Submit a stream URL → fast lane → summary appears; transcript shows the
  "auto-captions" badge and no speaker labels.
- Submit a `…nocaptions…` stream URL → fallback path completes end-to-end with
  diarized speakers (today's behavior).

### Gates

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e` all
green before the branch is considered done.

## Risks

- **YouTube anti-scraping.** Caption fetching via yt-dlp is a moving target
  (IP blocks, token requirements). Mitigated by: auto-fallback to audio (never
  breaks), and the `CAPTION_FASTLANE=false` kill switch.
- **Caption quality.** Auto-captions lack punctuation/casing; Claude tolerates
  this well in summarization. No cleanup pass in v1 (YAGNI).
