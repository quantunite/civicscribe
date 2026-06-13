// Recurrence math for scheduled capture. All wall-clock reasoning happens in
// the recurrence's IANA timezone via luxon, so occurrences keep their local
// time across DST transitions; results are returned as UTC instants.

import { DateTime } from "luxon";

import type { Recurrence } from "@/lib/types";

/** JS weekday (0=Sun..6=Sat) -> luxon weekday (1=Mon..7=Sun). */
function luxonWeekday(jsWeekday: number): number {
  return jsWeekday === 0 ? 7 : jsWeekday;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":");
  return { hour: Number(h), minute: Number(m) };
}

/**
 * The first occurrence strictly after `after`. Used to seed a schedule's
 * next_fire_at at creation; the chosen instant also defines the weekly phase.
 */
export function firstFireAfter(rec: Recurrence, after: Date): Date {
  const afterDt = DateTime.fromJSDate(after, { zone: rec.timezone });
  const occ =
    rec.freq === "weekly"
      ? weeklyOnOrAfter(rec, afterDt)
      : monthlyAfter(rec, afterDt);
  return occ.toUTC().toJSDate();
}

/**
 * The next occurrence strictly after a known occurrence instant. Used to
 * advance next_fire_at after a fire. Adding weeks/months in the local zone
 * preserves the wall-clock time across DST.
 */
export function nextFire(rec: Recurrence, current: Date): Date {
  const cur = DateTime.fromJSDate(current, { zone: rec.timezone });
  if (rec.freq === "weekly") {
    const interval = rec.interval && rec.interval > 0 ? rec.interval : 1;
    return cur.plus({ weeks: interval }).toUTC().toJSDate();
  }
  // Monthly: the nth weekday of the next month that actually has one.
  return monthlyAfter(rec, cur).toUTC().toJSDate();
}

function weeklyOnOrAfter(
  rec: Extract<Recurrence, { freq: "weekly" }>,
  afterDt: DateTime
): DateTime {
  const { hour, minute } = parseTime(rec.time);
  const target = luxonWeekday(rec.weekday);
  let cand = afterDt.set({ hour, minute, second: 0, millisecond: 0 });
  cand = cand.plus({ days: (target - cand.weekday + 7) % 7 });
  if (cand <= afterDt) cand = cand.plus({ weeks: 1 });
  return cand;
}

function monthlyAfter(
  rec: Extract<Recurrence, { freq: "monthly" }>,
  afterDt: DateTime
): DateTime {
  const { hour, minute } = parseTime(rec.time);
  let year = afterDt.year;
  let month = afterDt.month;
  // Scan forward (at most ~13 months) for the next existing nth-weekday > after.
  for (let i = 0; i < 14; i++) {
    if (month > 12) {
      month -= 12;
      year += 1;
    }
    const occ = nthWeekdayOfMonth(
      year,
      month,
      rec.weekday,
      rec.nth,
      hour,
      minute,
      rec.timezone
    );
    if (occ && occ > afterDt) return occ;
    month += 1;
  }
  throw new Error(`No occurrence for recurrence: ${JSON.stringify(rec)}`);
}

/** The nth (1-based; -1 = last) `weekday` of a month at the given local time,
 *  or null when that month has no nth occurrence (e.g. a 5th Tuesday). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  jsWeekday: number,
  nth: number,
  hour: number,
  minute: number,
  zone: string
): DateTime | null {
  const target = luxonWeekday(jsWeekday);
  if (nth === -1) {
    const lastDay = DateTime.fromObject({ year, month, day: 1 }, { zone }).endOf(
      "month"
    ).day;
    const d = DateTime.fromObject(
      { year, month, day: lastDay, hour, minute },
      { zone }
    );
    return d.minus({ days: (d.weekday - target + 7) % 7 });
  }
  const first = DateTime.fromObject(
    { year, month, day: 1, hour, minute },
    { zone }
  );
  const firstTarget = first.plus({ days: (target - first.weekday + 7) % 7 });
  const occ = firstTarget.plus({ weeks: nth - 1 });
  return occ.month === month ? occ : null;
}
