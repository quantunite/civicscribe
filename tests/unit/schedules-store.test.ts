// Store round-trip for the one-off vs recurring schedule fields. A one-off
// persists one_off:true with a null recurrence; a recurring schedule persists
// one_off:false with a non-null recurrence. Runs against MemoryStore (the
// MOCK_MODE backend); SupabaseStore is not unit-tested here, consistent with
// the rest of the suite.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import type { NewSchedule } from "@/lib/types";
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

const FUTURE = "2099-01-05T18:00:00.000Z";

function oneOff(): NewSchedule {
  return {
    title: "Record once",
    body_name: "Lawrence City Council",
    source_type: "stream",
    source_spec: { type: "fixed_url", url: "https://example.org/live" },
    recurrence: null,
    one_off: true,
    next_fire_at: FUTURE,
  };
}

function recurring(): NewSchedule {
  return {
    title: "City Council",
    body_name: "Lawrence City Council",
    source_type: "stream",
    source_spec: { type: "fixed_url", url: "https://example.org/live" },
    recurrence: {
      freq: "weekly",
      weekday: 2,
      time: "18:00",
      timezone: "America/Chicago",
    },
    next_fire_at: FUTURE,
  };
}

describe("MemoryStore schedules: one-off vs recurring round-trip", () => {
  it("round-trips a one-off: one_off true, recurrence null", async () => {
    const created = await store.createSchedule(oneOff());
    expect(created.one_off).toBe(true);
    expect(created.recurrence).toBeNull();
    expect(created.next_fire_at).toBe(FUTURE);

    const fetched = await store.getSchedule(created.id);
    expect(fetched?.one_off).toBe(true);
    expect(fetched?.recurrence).toBeNull();

    const listed = await store.listSchedules();
    const match = listed.find((s) => s.id === created.id);
    expect(match?.one_off).toBe(true);
    expect(match?.recurrence).toBeNull();
  });

  it("round-trips a recurring schedule: one_off false, recurrence set", async () => {
    const created = await store.createSchedule(recurring());
    expect(created.one_off).toBe(false);
    expect(created.recurrence).not.toBeNull();
    expect(created.recurrence?.freq).toBe("weekly");

    const fetched = await store.getSchedule(created.id);
    expect(fetched?.one_off).toBe(false);
    expect(fetched?.recurrence?.freq).toBe("weekly");
  });

  it("defaults one_off to false when omitted (recurring)", async () => {
    const input = recurring();
    const created = await store.createSchedule(input);
    expect(created.one_off).toBe(false);
  });
});
