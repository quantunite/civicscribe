"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { Recurrence, Schedule } from "@/lib/types";

const inputClass =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-sm placeholder:text-ink-soft/70";
const labelClass = "block font-semibold text-ink";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const NTH_OPTIONS = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
  { value: -1, label: "last" },
];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function errorMessage(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return null;
}

export default function NewScheduleForm() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [bodyName, setBodyName] = useState("");
  const [kind, setKind] = useState<"civic" | "course">("civic");
  const [sourceType, setSourceType] = useState<"zoom" | "stream">("stream");
  const [sourceUrl, setSourceUrl] = useState("");

  const [freq, setFreq] = useState<"weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState(2); // Tuesday
  const [time, setTime] = useState("18:00");
  const [timezone, setTimezone] = useState(browserTimezone());
  const [interval, setInterval] = useState(1);
  const [nth, setNth] = useState(2);

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  function buildRecurrence(): Recurrence {
    if (freq === "weekly") {
      return {
        freq: "weekly",
        weekday,
        time,
        timezone,
        interval: interval > 1 ? interval : undefined,
      };
    }
    return { freq: "monthly", weekday, nth, time, timezone };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    setSubmitting(true);
    setStatus("Creating schedule…");
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body_name: bodyName.trim(),
          kind,
          source_type: sourceType,
          source_url: sourceUrl.trim(),
          recurrence: buildRecurrence(),
        }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new Error(
          errorMessage(payload) ??
            `The server couldn't create the schedule (error ${res.status}).`
        );
      }
      const schedule = (await res.json()) as Schedule;
      setStatus(`Schedule "${schedule.title}" created. Opening schedules…`);
      router.push("/schedules");
      router.refresh();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setStatus("");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      <div>
        <label htmlFor="sched-title" className={labelClass}>
          Schedule title
        </label>
        <input
          id="sched-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="City Council Regular Session"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="sched-body" className={labelClass}>
          Public body
        </label>
        <input
          id="sched-body"
          type="text"
          required
          value={bodyName}
          onChange={(e) => setBodyName(e.target.value)}
          placeholder="Lawrence City Council"
          className={inputClass}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="sched-source-type" className={labelClass}>
            Source
          </label>
          <select
            id="sched-source-type"
            value={sourceType}
            onChange={(e) =>
              setSourceType(e.target.value as "zoom" | "stream")
            }
            className={inputClass}
          >
            <option value="stream">Stream / video URL</option>
            <option value="zoom">Zoom link</option>
          </select>
        </div>
        <div>
          <label htmlFor="sched-kind" className={labelClass}>
            Type
          </label>
          <select
            id="sched-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "civic" | "course")}
            className={inputClass}
          >
            <option value="civic">Civic meeting</option>
            <option value="course">Crash Course video</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="sched-url" className={labelClass}>
          {sourceType === "zoom" ? "Recurring Zoom link" : "Stream / video URL"}
        </label>
        <input
          id="sched-url"
          type="url"
          inputMode="url"
          required
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={
            sourceType === "zoom"
              ? "https://us02web.zoom.us/j/1234567890"
              : "https://www.youtube.com/@city/live"
          }
          className={inputClass}
        />
        <p className="mt-2 text-sm text-ink-soft">
          Used for every occurrence. Tip: set the time a bit after the meeting
          to grab the posted recording (captions, no live timing).
        </p>
      </div>

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="mb-2 font-semibold text-ink">Recurrence</legend>
        <div>
          <label htmlFor="sched-freq" className={labelClass}>
            Frequency
          </label>
          <select
            id="sched-freq"
            value={freq}
            onChange={(e) => setFreq(e.target.value as "weekly" | "monthly")}
            className={inputClass}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly (nth weekday)</option>
          </select>
        </div>
        <div>
          <label htmlFor="sched-weekday" className={labelClass}>
            Day of week
          </label>
          <select
            id="sched-weekday"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            className={inputClass}
          >
            {WEEKDAYS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {freq === "weekly" ? (
          <div>
            <label htmlFor="sched-interval" className={labelClass}>
              Every N weeks
            </label>
            <input
              id="sched-interval"
              type="number"
              min={1}
              max={52}
              value={interval}
              onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))}
              className={inputClass}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="sched-nth" className={labelClass}>
              Which occurrence
            </label>
            <select
              id="sched-nth"
              value={nth}
              onChange={(e) => setNth(Number(e.target.value))}
              className={inputClass}
            >
              {NTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="sched-time" className={labelClass}>
            Time (local)
          </label>
          <input
            id="sched-time"
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="sched-tz" className={labelClass}>
            Timezone (IANA)
          </label>
          <input
            id="sched-tz"
            type="text"
            required
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/Chicago"
            className={inputClass}
          />
        </div>
      </fieldset>

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-900"
        >
          {serverError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-12 items-center rounded-md bg-accent px-7 text-lg font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create schedule"}
        </button>
        <p aria-live="polite" className="text-sm font-medium text-ink-soft">
          {status}
        </p>
      </div>
    </form>
  );
}
