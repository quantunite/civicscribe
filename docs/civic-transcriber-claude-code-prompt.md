# Claude Code Kickoff Prompt: Civic Meeting Transcriber

Paste everything below the line into Claude Code from an empty directory.

---

You are building a complete v1 of "CivicScribe", a public meeting capture and transcription service for a hard-of-hearing user who cannot always attend public meetings live. Work autonomously through the night. Do not stop to ask questions. When you face a decision, make a reasonable call, document it in DECISIONS.md, and keep moving. Commit to git after every meaningful unit of work with clear messages. Maintain a STATUS.md at the repo root that you update as you complete each milestone, so the state of the build is obvious at a glance in the morning.

## Product summary

The user submits meetings three ways: a Zoom meeting URL (captured via the Recall.ai bot API), a public stream URL (captured via yt-dlp), or a direct audio/video file upload. The system captures or ingests the audio, transcribes it with speaker diarization, generates a structured summary with the Anthropic API, stores everything, and presents it in a searchable web archive. Email notification on completion is a stretch goal.

## Stack (do not deviate)

- Next.js 15, App Router, TypeScript, Tailwind
- Supabase for Postgres, auth, and storage (use the local Supabase CLI dev stack; write proper migrations in supabase/migrations)
- AssemblyAI for transcription AND diarization in one call (this is deliberate: one provider, speaker labels included, simplest possible v1). Wrap it behind a TranscriptionProvider interface so Whisper or Deepgram can be swapped in later.
- Anthropic API (claude-sonnet-4-20250514) for meeting summaries
- Recall.ai REST API for Zoom bot capture
- yt-dlp invoked as a subprocess for stream ingestion
- Resend for email (stub it; implement the interface, log emails to console in dev)

## Critical requirement: MOCK_MODE

Every external service (Recall.ai, AssemblyAI, Anthropic, Resend, yt-dlp) must sit behind a thin provider interface with two implementations: real (reads API key from env) and mock. A single env var MOCK_MODE=true switches all providers to mocks. Mocks must return realistic fixture data: include a fixture diarized transcript of a fake city council meeting (at least 40 utterances, 4 speakers, realistic municipal content like zoning votes and public comment) and a corresponding fixture summary. The entire app must run end-to-end in MOCK_MODE with zero API keys, including the full submit-process-view flow. This is how the build will be verified in the morning before any keys are wired in.

## Data model (Supabase migrations)

- meetings: id, title, body_name (e.g. "Lawrence City Council"), source_type (zoom | stream | upload), source_url, status (pending | capturing | transcribing | summarizing | complete | failed), error_message, scheduled_at, audio_storage_path, duration_seconds, created_at
- transcripts: id, meeting_id, raw_json (full provider response), language, created_at
- utterances: id, transcript_id, speaker_label, speaker_name (nullable, user-editable), start_ms, end_ms, text. Add a tsvector column with a GIN index for full-text search across utterances.
- summaries: id, meeting_id, overview, key_decisions (jsonb array), action_items (jsonb array), topics (jsonb array), full_markdown
- speaker_aliases: id, body_name, speaker_label_pattern, display_name (so "Speaker A" in recurring meetings can be mapped to real names once and reused)

## Processing pipeline

Implement a simple job runner: a jobs table in Postgres (id, meeting_id, type, status, attempts, last_error, payload jsonb) plus a worker loop exposed as a Next.js API route (POST /api/jobs/tick) that claims and processes one pending job per invocation using SELECT FOR UPDATE SKIP LOCKED. Include a dev script (npm run worker) that polls the tick endpoint every 5 seconds. Job chain: capture -> transcribe -> summarize -> notify. Each stage updates meetings.status. Max 3 attempts per job, then mark failed with the error surfaced in the UI.

Capture stage behavior by source_type:
- zoom: create a Recall.ai bot for the meeting URL, poll (or accept webhook at /api/webhooks/recall) until the recording is ready, download audio to Supabase storage
- stream: run yt-dlp to extract audio (m4a/opus), upload to Supabase storage; handle the live-stream case by passing appropriate yt-dlp flags and document the limitation that scheduled live capture is v2
- upload: file is already in storage, skip straight to transcribe

Summarize stage: send the diarized transcript to the Anthropic API with a prompt that returns strict JSON containing overview, key_decisions, action_items, and topics, plus a full_markdown narrative summary. Parse defensively, strip code fences, retry once on parse failure.

## Frontend pages

- / : meetings dashboard. Cards with title, body, date, status badge with live polling while processing, duration. Prominent "Add meeting" button.
- /meetings/new : form with three tabs (Zoom URL, Stream URL, Upload file). Client-side validation. Uploads go directly to Supabase storage.
- /meetings/[id] : the core view. Summary panel at top (overview, decisions, action items as styled sections). Below it the full transcript as a virtualized list of utterances with timestamps, speaker labels in distinct colors, and inline editing of speaker names (editing one label offers to apply it to all utterances with that label and save it as a speaker_alias). Sticky search box that filters utterances and highlights matches. An audio player pinned to the bottom that seeks when a timestamp is clicked.
- /search : global full-text search across all meetings, results grouped by meeting with utterance snippets and deep links that scroll to the matching utterance.

Design notes: this is an accessibility-first product for a hard-of-hearing user. Large readable type for transcripts (18px minimum), strong contrast, generous line height, keyboard navigable, semantic HTML, visible focus states. Clean civic aesthetic, not flashy.

## Configuration

Create .env.example documenting every variable: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ASSEMBLYAI_API_KEY, ANTHROPIC_API_KEY, RECALL_API_KEY, RECALL_REGION, RESEND_API_KEY, NOTIFY_EMAIL, MOCK_MODE. The app must boot with only MOCK_MODE=true set.

## Quality bar and verification

- TypeScript strict mode, no any escapes in core logic
- Unit tests (Vitest) for: job runner claim/retry logic, transcript parsing into utterances, summary JSON parsing with malformed input, speaker alias application
- One Playwright e2e test that runs in MOCK_MODE: create an upload meeting with a fixture file, run the worker until complete, open the meeting page, assert summary and utterances render, edit a speaker name, search for a term and find it
- Seed script (npm run seed) that inserts two complete mock meetings so the dashboard is demoable immediately
- README.md with: 5-minute quickstart in MOCK_MODE, then a "going live" section explaining exactly how to obtain each API key (note that Recall.ai requires signup approval) and what to test first
- Before finishing, actually run: type check, lint, all unit tests, the e2e test, and a manual-equivalent verification of the full mock pipeline. Fix what fails. Do not declare done with failing checks.

## Explicit non-goals for tonight (list these in README as v2)

Real-time live captions, Playwright-based capture of obscure municipal video players, Twilio dial-in capture, scheduled automatic capture of recurring meetings, multi-user auth (single-user is fine, keep Supabase RLS simple), speaker voice enrollment.

## Final deliverable

When everything passes, write a FINAL_REPORT.md summarizing what was built, every decision made, known limitations, exact commands to run it, and the ordered checklist of steps to go from mock to live. End on a clean commit.
