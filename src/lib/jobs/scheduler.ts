// Host-agnostic schedule sweep. Runs on every tick (alongside the job runner)
// so it works whether ticks come from the persistent worker or an external
// cron. When a schedule is due it materializes ONE meeting + capture job for
// the due occurrence (idempotently) and advances next_fire_at to the next
// occurrence after now — skipping missed ones so a long-down worker doesn't
// replay the whole backlog.

import { createAndEnqueueCapture } from "@/lib/meetings/create";
import { nextFire } from "@/lib/schedule/recurrence";
import { resolveCaptureUrl } from "@/lib/schedule/resolver";
import type { DataStore } from "@/lib/store/types";

export interface ScheduleFireResult {
  scheduleId: string;
  occurrenceKey: string;
  meetingId: string | null;
  skipped: boolean;
  error?: string;
}

export interface SweepResult {
  fired: ScheduleFireResult[];
}

export async function sweepSchedules(
  store: DataStore,
  now: Date = new Date()
): Promise<SweepResult> {
  const due = await store.listDueSchedules(now);
  const fired: ScheduleFireResult[] = [];

  for (const schedule of due) {
    const occurrenceKey = schedule.next_fire_at;
    const result: ScheduleFireResult = {
      scheduleId: schedule.id,
      occurrenceKey,
      meetingId: null,
      skipped: false,
    };

    try {
      const existing = await store.getMeetingByOccurrence(
        schedule.id,
        occurrenceKey
      );
      if (existing) {
        result.skipped = true;
        result.meetingId = existing.id;
      } else {
        const url = resolveCaptureUrl(schedule.source_spec);
        if (!url) {
          result.skipped = true;
          result.error = "source could not be resolved to a URL";
        } else {
          const meeting = await createAndEnqueueCapture(store, {
            title: schedule.title,
            body_name: schedule.body_name,
            kind: schedule.kind,
            source_type: schedule.source_type,
            source_url: url,
            schedule_id: schedule.id,
            occurrence_key: occurrenceKey,
          });
          result.meetingId = meeting.id;
        }
      }
    } catch (err) {
      // A unique-violation here means a concurrent tick already materialized
      // this occurrence — treat it as already-fired, not a hard error.
      result.skipped = true;
      result.error = err instanceof Error ? err.message : String(err);
    }

    // Advance to the next occurrence strictly after now (skip missed ones).
    let next = nextFire(schedule.recurrence, new Date(occurrenceKey));
    let guard = 0;
    while (next.getTime() <= now.getTime() && guard < 5000) {
      next = nextFire(schedule.recurrence, next);
      guard += 1;
    }
    await store.updateSchedule(schedule.id, {
      next_fire_at: next.toISOString(),
      last_fired_at: now.toISOString(),
    });

    fired.push(result);
  }

  return { fired };
}
