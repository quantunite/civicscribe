// Seed script: inserts two complete demo meetings (city council + planning
// commission) so the dashboard is demoable immediately.
//
//   npm run seed            -> seeds the local MOCK_MODE store (.data/db.json)
//   MOCK_MODE=false + Supabase env vars -> seeds Supabase instead
//
// Idempotent-ish: a meeting whose title already exists in the store is skipped.
//
// NOTE: imports are relative (not "@/...") so tsx resolves them without
// relying on tsconfig path mapping.

// Default to the local file-backed store. getConfig() is read lazily inside
// getStore()/getFileStorage(), so setting this before the first store access
// is sufficient even though ESM imports are hoisted above this line.
process.env.MOCK_MODE ??= "true";

import { getStore, getFileStorage } from "../src/lib/store";
import type { DataStore, FileStorage } from "../src/lib/store/types";
import type { MeetingSummaryContent, NewUtterance } from "../src/lib/types";
import {
  buildFixtureRawResponse,
  FIXTURE_COUNCIL_UTTERANCES,
  FIXTURE_COUNCIL_SUMMARY,
  FIXTURE_PLANNING_UTTERANCES,
  FIXTURE_PLANNING_SUMMARY,
} from "../src/lib/fixtures";
import { synthesizeWav } from "../src/lib/fixtures/audio";

/** The structural slice of a fixture meeting this script relies on. */
interface SeedFixture {
  title: string;
  body_name: string;
  utterances: NewUtterance[];
  summary: MeetingSummaryContent;
  durationSeconds?: number;
}

function fixtureDurationSeconds(fixture: SeedFixture): number {
  if (typeof fixture.durationSeconds === "number") {
    return fixture.durationSeconds;
  }
  const lastEndMs = fixture.utterances.reduce(
    (max, u) => Math.max(max, u.end_ms),
    0
  );
  return Math.max(1, Math.ceil(lastEndMs / 1000));
}

interface SeedResult {
  title: string;
  skipped: boolean;
  meetingId?: string;
  utterances?: number;
}

async function seedMeeting(
  store: DataStore,
  files: FileStorage,
  fixture: SeedFixture
): Promise<SeedResult> {
  const existing = await store.listMeetings();
  if (existing.some((m) => m.title === fixture.title)) {
    return { title: fixture.title, skipped: true };
  }

  // 1. The meeting itself (an already-processed upload).
  const meeting = await store.createMeeting({
    title: fixture.title,
    body_name: fixture.body_name,
    source_type: "upload",
  });

  // 2. Synthesized WAV audio at the canonical storage path.
  const durationSeconds = fixtureDurationSeconds(fixture);
  const wav = Buffer.from(synthesizeWav(durationSeconds));
  const audioPath = `meetings/${meeting.id}/audio.wav`;
  await files.put(audioPath, wav, "audio/wav");

  await store.updateMeeting(meeting.id, {
    audio_storage_path: audioPath,
    duration_seconds: durationSeconds,
    status: "complete",
  });

  // 3. Transcript (verbatim provider-shaped raw response) + utterances.
  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: buildFixtureRawResponse(fixture.utterances),
    language: "en",
  });
  await store.createUtterances(transcript.id, fixture.utterances);

  // 4. Summary.
  await store.createSummary(meeting.id, fixture.summary);

  return {
    title: fixture.title,
    skipped: false,
    meetingId: meeting.id,
    utterances: fixture.utterances.length,
  };
}

async function main(): Promise<void> {
  const store = getStore();
  const files = getFileStorage();
  const mode = process.env.MOCK_MODE === "true" ? "local (MOCK_MODE)" : "supabase";
  console.log(`[seed] seeding ${mode} store...`);

  const fixtures: SeedFixture[] = [
    {
      title: "Lawrence City Council — Regular Session",
      body_name: "Lawrence City Council",
      utterances: FIXTURE_COUNCIL_UTTERANCES,
      summary: FIXTURE_COUNCIL_SUMMARY,
    },
    {
      title: "Planning Commission — Conditional Use Hearing",
      body_name: "Lawrence Planning Commission",
      utterances: FIXTURE_PLANNING_UTTERANCES,
      summary: FIXTURE_PLANNING_SUMMARY,
    },
  ];
  const results: SeedResult[] = [];
  for (const fixture of fixtures) {
    results.push(await seedMeeting(store, files, fixture));
  }

  console.log("[seed] done:");
  for (const r of results) {
    if (r.skipped) {
      console.log(`  - "${r.title}" already exists, skipped`);
    } else {
      console.log(
        `  - "${r.title}" (${r.meetingId}): ${r.utterances} utterances, ` +
          "audio + transcript + summary created"
      );
    }
  }
  const created = results.filter((r) => !r.skipped).length;
  console.log(
    `[seed] ${created} meeting(s) created, ${results.length - created} skipped.`
  );
}

main().catch((err: unknown) => {
  console.error("[seed] failed:", err);
  process.exitCode = 1;
});
