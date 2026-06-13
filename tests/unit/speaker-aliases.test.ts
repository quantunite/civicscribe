// Speaker alias behavior: MemoryStore.applySpeakerNameToLabel scoping and
// counts, upsertSpeakerAlias upsert semantics, and the transcribe stage's
// automatic alias application (exact label match, body-scoped) using stub
// providers + file storage over a real MemoryStore.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleTranscribe } from "@/lib/jobs/stages/transcribe";
import { MemoryStore } from "@/lib/store/memory";
import type { FileStorage } from "@/lib/store/types";
import type { Providers, TranscriptionResult } from "@/lib/providers/types";
import type { Job, Meeting, Transcript } from "@/lib/types";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

async function makeMeetingWithTranscript(
  bodyName: string,
  labels: string[]
): Promise<{ meeting: Meeting; transcript: Transcript }> {
  const meeting = await store.createMeeting({
    title: `Meeting of ${bodyName}`,
    body_name: bodyName,
    source_type: "upload",
  });
  const transcript = await store.createTranscript({
    meeting_id: meeting.id,
    raw_json: { status: "completed" },
    language: "en",
  });
  await store.createUtterances(
    transcript.id,
    labels.map((label, i) => ({
      speaker_label: label,
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
      text: `Utterance ${i} by ${label}`,
    }))
  );
  return { meeting, transcript };
}

describe("MemoryStore.applySpeakerNameToLabel", () => {
  it("renames every matching utterance and returns the count", async () => {
    const { transcript } = await makeMeetingWithTranscript("Council", [
      "A",
      "B",
      "A",
      "C",
      "A",
    ]);

    const count = await store.applySpeakerNameToLabel(
      transcript.id,
      "A",
      "Mayor Whitfield"
    );

    expect(count).toBe(3);
    const utterances = await store.listUtterances(transcript.id);
    for (const u of utterances) {
      if (u.speaker_label === "A") {
        expect(u.speaker_name).toBe("Mayor Whitfield");
      } else {
        expect(u.speaker_name).toBeNull();
      }
    }
  });

  it("only touches the given transcript, not other transcripts with the same label", async () => {
    const { transcript: t1 } = await makeMeetingWithTranscript("Council", [
      "A",
      "B",
    ]);
    const { transcript: t2 } = await makeMeetingWithTranscript("Council", [
      "A",
      "A",
    ]);

    const count = await store.applySpeakerNameToLabel(t1.id, "A", "Mayor");

    expect(count).toBe(1);
    const inT2 = await store.listUtterances(t2.id);
    expect(inT2.every((u) => u.speaker_name === null)).toBe(true);
  });

  it("returns 0 when no utterance has the label", async () => {
    const { transcript } = await makeMeetingWithTranscript("Council", [
      "A",
      "B",
    ]);

    const count = await store.applySpeakerNameToLabel(
      transcript.id,
      "Z",
      "Nobody"
    );

    expect(count).toBe(0);
    const utterances = await store.listUtterances(transcript.id);
    expect(utterances.every((u) => u.speaker_name === null)).toBe(true);
  });
});

describe("MemoryStore.upsertSpeakerAlias", () => {
  it("updates in place for the same body + pattern (no duplicate row)", async () => {
    const first = await store.upsertSpeakerAlias({
      body_name: "Council",
      speaker_label_pattern: "A",
      display_name: "Mayor Whitfield",
    });
    const second = await store.upsertSpeakerAlias({
      body_name: "Council",
      speaker_label_pattern: "A",
      display_name: "Mayor Deborah Whitfield",
    });

    expect(second.id).toBe(first.id);
    expect(second.display_name).toBe("Mayor Deborah Whitfield");

    const aliases = await store.listSpeakerAliases("Council");
    expect(aliases).toHaveLength(1);
    expect(aliases[0].display_name).toBe("Mayor Deborah Whitfield");
  });

  it("creates separate rows for different patterns or different bodies", async () => {
    await store.upsertSpeakerAlias({
      body_name: "Council",
      speaker_label_pattern: "A",
      display_name: "Mayor",
    });
    await store.upsertSpeakerAlias({
      body_name: "Council",
      speaker_label_pattern: "B",
      display_name: "Councilor Ramos",
    });
    await store.upsertSpeakerAlias({
      body_name: "Planning Commission",
      speaker_label_pattern: "A",
      display_name: "Chair Okafor",
    });

    expect(await store.listSpeakerAliases()).toHaveLength(3);
    expect(await store.listSpeakerAliases("Council")).toHaveLength(2);
    expect(await store.listSpeakerAliases("Planning Commission")).toHaveLength(1);
    expect(await store.listSpeakerAliases("School Board")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transcribe stage: stored aliases for the meeting's body are auto-applied to
// exactly-matching speaker labels right after utterances are persisted.

const STAGE_RESULT: TranscriptionResult = {
  rawJson: { id: "raw-1", status: "completed" },
  language: "en",
  durationSeconds: 1234.6,
  utterances: [
    { speaker_label: "A", start_ms: 0, end_ms: 900, text: "Call to order." },
    { speaker_label: "B", start_ms: 1000, end_ms: 1900, text: "Present." },
    { speaker_label: "A", start_ms: 2000, end_ms: 2900, text: "Thank you." },
  ],
};

function stubFiles(): FileStorage {
  return {
    async put() {
      /* not used by the transcribe stage */
    },
    async get(storagePath: string) {
      return {
        data: Buffer.from(`fake audio for ${storagePath}`),
        contentType: "audio/wav",
      };
    },
    publicUrl: (p: string) => `/api/audio/${p}`,
  };
}

function stubProviders(result: TranscriptionResult): Providers {
  const unused = () => {
    throw new Error("provider not expected in this test");
  };
  return {
    capture: {
      createBot: unused,
      getBotStatus: unused,
      downloadAudio: unused,
    },
    streamIngest: { fetchCaptions: unused, extractAudio: unused },
    transcription: {
      async transcribe() {
        return result;
      },
    },
    summary: { summarize: unused },
    email: { sendCompletionEmail: unused },
  };
}

function jobFor(meetingId: string): Job {
  const ts = new Date().toISOString();
  return {
    id: "job-transcribe-1",
    meeting_id: meetingId,
    type: "transcribe",
    status: "running",
    attempts: 0,
    last_error: null,
    payload: {},
    created_at: ts,
    updated_at: ts,
  };
}

describe("transcribe stage alias auto-application", () => {
  it("applies body-scoped aliases to exact label matches only", async () => {
    const meeting = await store.createMeeting({
      title: "Regular Session",
      body_name: "Lawrence City Council",
      source_type: "upload",
      audio_storage_path: "meetings/m1/audio.wav",
    });

    // Matching body + matching label -> applied.
    await store.upsertSpeakerAlias({
      body_name: "Lawrence City Council",
      speaker_label_pattern: "A",
      display_name: "Mayor Whitfield",
    });
    // Matching body but no utterance with this label -> ignored.
    await store.upsertSpeakerAlias({
      body_name: "Lawrence City Council",
      speaker_label_pattern: "Z",
      display_name: "Ghost Speaker",
    });
    // Different body, label exists -> must NOT be applied.
    await store.upsertSpeakerAlias({
      body_name: "Planning Commission",
      speaker_label_pattern: "B",
      display_name: "Wrong Person",
    });

    await handleTranscribe(
      jobFor(meeting.id),
      store,
      stubFiles(),
      stubProviders(STAGE_RESULT)
    );

    const transcript = await store.getTranscriptByMeeting(meeting.id);
    expect(transcript).not.toBeNull();
    expect(transcript?.raw_json).toEqual(STAGE_RESULT.rawJson);

    const utterances = await store.listUtterances(transcript!.id);
    expect(utterances).toHaveLength(3);
    const byLabel = (label: string) =>
      utterances.filter((u) => u.speaker_label === label);

    for (const u of byLabel("A")) {
      expect(u.speaker_name).toBe("Mayor Whitfield");
    }
    for (const u of byLabel("B")) {
      expect(u.speaker_name).toBeNull();
    }

    // Stage bookkeeping: status flipped and duration recorded (rounded).
    const updated = await store.getMeeting(meeting.id);
    expect(updated?.status).toBe("transcribing");
    expect(updated?.duration_seconds).toBe(1235);
  });

  it("leaves names untouched when the body has no stored aliases", async () => {
    const meeting = await store.createMeeting({
      title: "First Session",
      body_name: "Brand New Board",
      source_type: "upload",
      audio_storage_path: "meetings/m2/audio.wav",
    });

    await handleTranscribe(
      jobFor(meeting.id),
      store,
      stubFiles(),
      stubProviders(STAGE_RESULT)
    );

    const transcript = await store.getTranscriptByMeeting(meeting.id);
    const utterances = await store.listUtterances(transcript!.id);
    expect(utterances).toHaveLength(3);
    expect(utterances.every((u) => u.speaker_name === null)).toBe(true);
  });

  it("fails loudly when the meeting has no captured audio", async () => {
    const meeting = await store.createMeeting({
      title: "No Audio Yet",
      body_name: "Lawrence City Council",
      source_type: "zoom",
      source_url: "https://zoom.us/j/123",
    });

    await expect(
      handleTranscribe(
        jobFor(meeting.id),
        store,
        stubFiles(),
        stubProviders(STAGE_RESULT)
      )
    ).rejects.toThrow(/no audio_storage_path/);
  });
});
