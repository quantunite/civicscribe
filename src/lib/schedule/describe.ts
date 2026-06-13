// Human-readable recurrence summary for the UI. Pure + luxon-free so it can be
// imported into client components without bundling the date library.

import type { Recurrence } from "@/lib/types";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th"];

export function describeRecurrence(rec: Recurrence): string {
  const day = WEEKDAY_NAMES[rec.weekday] ?? "?";
  if (rec.freq === "weekly") {
    const n = rec.interval && rec.interval > 1 ? rec.interval : 1;
    const cadence = n === 1 ? `Every ${day}` : `Every ${n} weeks on ${day}`;
    return `${cadence} at ${rec.time} · ${rec.timezone}`;
  }
  const nth = rec.nth === -1 ? "last" : (ORDINALS[rec.nth] ?? `${rec.nth}th`);
  return `${nth} ${day} of each month at ${rec.time} · ${rec.timezone}`;
}
