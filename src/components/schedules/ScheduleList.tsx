"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Meeting, Schedule } from "@/lib/types";
import { describeRecurrence } from "@/lib/schedule/describe";
import StatusBadge from "@/components/dashboard/StatusBadge";

function formatInstant(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  // Pinned locale so the date format itself is stable; the time-of-day is still
  // rendered in the runtime's timezone, so the server (UTC) and client (local)
  // differ — the <dd> carries suppressHydrationWarning for that intentional gap.
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function ScheduleList({
  initial,
  latestCaptures = {},
  isAdmin,
}: {
  initial: Schedule[];
  /** Newest meeting each schedule materialized, keyed by schedule id. Lets a
   *  fired schedule link to the capture (and its status/error) it produced. */
  latestCaptures?: Record<string, Meeting>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(schedule: Schedule) {
    setBusyId(schedule.id);
    setError(null);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(schedule: Schedule) {
    if (
      !window.confirm(
        `Delete the schedule "${schedule.title}"? Meetings it already captured are kept.`
      )
    ) {
      return;
    }
    setBusyId(schedule.id);
    setError(null);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  if (initial.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-8 text-center text-ink-soft">
        No schedules yet. Record a one-time capture, or set up a repeating one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-900"
        >
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {initial.map((s) => {
          // A one-off that has fired is done, not "paused": it auto-disables
          // after its single capture. Showing "Paused" + a "Resume" button (which
          // would only re-fire the same already-captured occurrence) is what made
          // a finished capture look like it never ran.
          const firedOneOff = s.one_off && s.last_fired_at != null;
          const capture = latestCaptures[s.id];
          return (
          <li
            key={s.id}
            className="rounded-xl border border-line bg-surface p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
                  {firedOneOff ? (
                    <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      Completed
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        s.enabled
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {s.enabled ? "Active" : "Paused"}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      s.one_off
                        ? "bg-amber-100 text-amber-900"
                        : "bg-sky-100 text-sky-900"
                    }`}
                  >
                    {s.one_off ? "One time" : "Repeating"}
                  </span>
                  {s.kind === "course" && (
                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-900">
                      Study Notes
                    </span>
                  )}
                </div>
                <p className="mt-1 text-ink-soft">{s.body_name}</p>
                <p className="mt-2 text-sm font-medium text-ink">
                  {s.one_off || s.recurrence === null
                    ? `One-time capture on ${formatInstant(s.next_fire_at)}`
                    : describeRecurrence(s.recurrence)}
                </p>
                <p className="mt-1 truncate text-sm text-ink-soft">
                  {s.source_type} · {s.source_spec.url}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
                  {!firedOneOff && (
                    <div className="flex gap-1.5">
                      <dt className="font-medium text-ink">Next run:</dt>
                      <dd suppressHydrationWarning>
                        {formatInstant(s.next_fire_at)}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <dt className="font-medium text-ink">
                      {firedOneOff ? "Captured:" : "Last run:"}
                    </dt>
                    <dd suppressHydrationWarning>
                      {formatInstant(s.last_fired_at)}
                    </dd>
                  </div>
                </dl>
                {capture && (
                  <div className="mt-3 flex flex-col gap-1 rounded-md border border-line bg-primary-soft/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ink">
                        Latest capture:
                      </span>
                      <StatusBadge status={capture.status} />
                      <Link
                        href={`/meetings/${capture.id}`}
                        className="font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        View capture →
                      </Link>
                    </div>
                    {capture.status === "failed" && capture.error_message && (
                      <p className="text-sm text-red-800">
                        {capture.error_message}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {isAdmin && (
                <div className="flex shrink-0 gap-2">
                  {/* A fired one-off is finished — editing its past time or
                      "resuming" it does nothing useful, so only Delete remains.
                      Recurring + not-yet-fired one-offs keep the full controls. */}
                  {!firedOneOff && (
                    <>
                      <Link
                        href={`/schedules/${s.id}/edit`}
                        className="inline-flex min-h-10 items-center rounded-md border border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-primary-soft"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggle(s)}
                        disabled={busyId === s.id}
                        className="inline-flex min-h-10 items-center rounded-md border border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-primary-soft disabled:opacity-60"
                      >
                        {s.enabled ? "Pause" : "Resume"}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    disabled={busyId === s.id}
                    className="inline-flex min-h-10 items-center rounded-md border border-red-200 bg-red-50 px-4 font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
