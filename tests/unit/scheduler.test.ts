// sweepSchedules: the host-agnostic tick sweep. When a schedule is due it
// materializes a meeting + capture job (idempotently) and advances next_fire_at
// to the next future occurrence. Runs against MemoryStore.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { sweepSchedules } from "@/lib/jobs/scheduler";
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

// A weekly Tuesday 18:00 America/Chicago stream schedule. 2026-07-14T23:00:00Z
// is one such occurrence (18:00 CDT).
function weeklyTuesday(nextFireAt: string): NewSchedule {
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
    next_fire_at: nextFireAt,
  };
}

// A one-off fires exactly once at a chosen instant: recurrence is null and the
// sweep disables it after firing (no nextFire advance).
function oneOff(nextFireAt: string): NewSchedule {
  return {
    title: "Record once",
    body_name: "Lawrence City Council",
    source_type: "stream",
    source_spec: { type: "fixed_url", url: "https://example.org/live" },
    recurrence: null,
    one_off: true,
    next_fire_at: nextFireAt,
  };
}

const OCCURRENCE = "2026-07-14T23:00:00.000Z";
const AFTER = new Date("2026-07-15T00:00:00.000Z");

describe("sweepSchedules", () => {
  it("materializes a meeting + capture job and advances a due schedule", async () => {
    const schedule = await store.createSchedule(weeklyTuesday(OCCURRENCE));

    const result = await sweepSchedules(store, AFTER);
    expect(result.fired).toHaveLength(1);

    const meetings = await store.listMeetings();
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      title: "City Council",
      body_name: "Lawrence City Council",
      source_type: "stream",
      source_url: "https://example.org/live",
      schedule_id: schedule.id,
      occurrence_key: OCCURRENCE,
    });

    const jobs = await store.getJobsByMeeting(meetings[0].id);
    expect(jobs.map((j) => j.type)).toEqual(["capture"]);
    expect(jobs[0].status).toBe("pending");

    const advanced = await store.getSchedule(schedule.id);
    expect(advanced?.next_fire_at).toBe("2026-07-21T23:00:00.000Z");
    expect(advanced?.last_fired_at).toBe(AFTER.toISOString());
  });

  it("does nothing for a schedule whose next_fire_at is in the future", async () => {
    const future = "2027-01-05T00:00:00.000Z";
    const schedule = await store.createSchedule(weeklyTuesday(future));

    const result = await sweepSchedules(store, AFTER);

    expect(result.fired).toHaveLength(0);
    expect(await store.listMeetings()).toHaveLength(0);
    expect((await store.getSchedule(schedule.id))?.next_fire_at).toBe(future);
  });

  it("does nothing for a disabled schedule", async () => {
    await store.createSchedule({ ...weeklyTuesday(OCCURRENCE), enabled: false });
    const result = await sweepSchedules(store, AFTER);
    expect(result.fired).toHaveLength(0);
    expect(await store.listMeetings()).toHaveLength(0);
  });

  it("is idempotent: the same occurrence never creates a second meeting", async () => {
    const schedule = await store.createSchedule(weeklyTuesday(OCCURRENCE));
    await sweepSchedules(store, AFTER);
    // Force the same occurrence to be due again (simulating an overlapping tick).
    await store.updateSchedule(schedule.id, { next_fire_at: OCCURRENCE });

    await sweepSchedules(store, AFTER);

    const forOccurrence = (await store.listMeetings()).filter(
      (m) => m.occurrence_key === OCCURRENCE
    );
    expect(forOccurrence).toHaveLength(1);
  });

  it("does NOT advance next_fire_at when materialization genuinely fails", async () => {
    // A transient store failure must not be mistaken for "already fired": the
    // occurrence stays due so the next tick retries it (no silent dropped capture).
    class FailingStore extends MemoryStore {
      async createMeeting(): Promise<never> {
        throw new Error("transient db error");
      }
    }
    const failing = new FailingStore(dataDir);
    const schedule = await failing.createSchedule(weeklyTuesday(OCCURRENCE));

    const result = await sweepSchedules(failing, AFTER);

    expect(result.fired[0].error).toBeTruthy();
    expect(await failing.listMeetings()).toHaveLength(0);
    // Still due — not advanced past the failed occurrence.
    expect((await failing.getSchedule(schedule.id))?.next_fire_at).toBe(
      OCCURRENCE
    );
  });

  it("MemoryStore.createMeeting rejects a duplicate (schedule_id, occurrence_key)", async () => {
    const base = new MemoryStore(dataDir);
    const common = {
      body_name: "b",
      source_type: "stream" as const,
      schedule_id: "s1",
      occurrence_key: "o1",
    };
    await base.createMeeting({ title: "first", ...common });
    await expect(
      base.createMeeting({ title: "second", ...common })
    ).rejects.toThrow();
  });

  it("fires a one-off exactly once then disables it", async () => {
    const schedule = await store.createSchedule(oneOff(OCCURRENCE));

    const first = await sweepSchedules(store, AFTER);
    expect(first.fired).toHaveLength(1);
    expect(await store.listMeetings()).toHaveLength(1);

    // Disabled after firing; next_fire_at is left at the fired instant.
    const after = await store.getSchedule(schedule.id);
    expect(after?.enabled).toBe(false);
    expect(after?.next_fire_at).toBe(OCCURRENCE);
    expect(after?.last_fired_at).toBe(AFTER.toISOString());

    // A later sweep materializes no second meeting (no longer due).
    const later = new Date("2026-08-01T00:00:00.000Z");
    const second = await sweepSchedules(store, later);
    expect(second.fired).toHaveLength(0);
    expect(await store.listMeetings()).toHaveLength(1);
  });

  it("catches up a long-stale schedule with one meeting and a future next_fire_at", async () => {
    // 2026-06-02T23:00:00Z is a Tuesday 18:00 CDT, six weeks before AFTER.
    const schedule = await store.createSchedule(
      weeklyTuesday("2026-06-02T23:00:00.000Z")
    );

    await sweepSchedules(store, AFTER);

    expect(await store.listMeetings()).toHaveLength(1);
    const advanced = await store.getSchedule(schedule.id);
    expect(new Date(advanced!.next_fire_at).getTime()).toBeGreaterThan(
      AFTER.getTime()
    );
    expect(advanced?.next_fire_at).toBe("2026-07-21T23:00:00.000Z");
  });
});
