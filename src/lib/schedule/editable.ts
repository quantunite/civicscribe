// A schedule's CONTENT (title, body, source URL, one-off capture time) can be
// edited only BEFORE it starts: its next fire is still in the future. After a
// one-off fires, next_fire_at sits in the past; a recurring schedule is
// editable up to its next run. Pause/resume (toggling `enabled`) is always
// allowed and does NOT go through this guard.

export function isScheduleEditable(
  nextFireAtIso: string,
  nowMs: number
): boolean {
  const t = new Date(nextFireAtIso).getTime();
  return !Number.isNaN(t) && t > nowMs;
}
