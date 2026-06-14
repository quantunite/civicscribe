"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { Recurrence, Schedule } from "@/lib/types";
import { isInternalHost, isZoomHost, parseHttpUrl } from "@/lib/net/url";

interface FieldErrors {
  title?: string;
  bodyName?: string;
  sourceUrl?: string;
  timezone?: string;
}

/** Map a server validation issue path to the form field it belongs to. */
function fieldForIssuePath(path: string): keyof FieldErrors | null {
  if (path === "title") return "title";
  if (path === "body_name") return "bodyName";
  if (path === "source_url") return "sourceUrl";
  if (path.startsWith("recurrence.timezone")) return "timezone";
  return null;
}

const inputClass =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-sm placeholder:text-ink-soft/70";
const labelClass = "block font-semibold text-ink";
const errorClass = "mt-2 text-sm font-medium text-red-800";
const RequiredMark = () => (
  <>
    {" "}
    <span aria-hidden="true" className="text-red-700">
      *
    </span>
    <span className="sr-only">(required)</span>
  </>
);

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

/** Pull the server's structured issues[] ({path, message}) off an error body. */
function extractIssues(payload: unknown): Array<{ path: string; message: string }> {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "issues" in payload &&
    Array.isArray((payload as { issues: unknown }).issues)
  ) {
    return (payload as { issues: Array<{ path: string; message: string }> })
      .issues;
  }
  return [];
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
  const [errors, setErrors] = useState<FieldErrors>({});

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const tzRef = useRef<HTMLInputElement>(null);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "Enter a schedule title.";
    if (!bodyName.trim()) next.bodyName = "Enter the public body or channel.";

    const url = parseHttpUrl(sourceUrl.trim());
    if (!sourceUrl.trim()) {
      next.sourceUrl = "Enter the source URL.";
    } else if (!url) {
      next.sourceUrl = "Enter a full http:// or https:// URL.";
    } else if (sourceType === "zoom" && !isZoomHost(url.hostname)) {
      next.sourceUrl = "Zoom sources must be a zoom.us link.";
    } else if (sourceType === "stream" && isInternalHost(url.hostname)) {
      next.sourceUrl =
        "Use a public host: localhost and private addresses aren't allowed.";
    }

    if (!timezone.trim()) {
      next.timezone = "Enter an IANA timezone, e.g. America/Chicago.";
    }
    return next;
  }

  function focusFirstError(next: FieldErrors) {
    if (next.title) titleRef.current?.focus();
    else if (next.bodyName) bodyRef.current?.focus();
    else if (next.sourceUrl) urlRef.current?.focus();
    else if (next.timezone) tzRef.current?.focus();
  }

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

    const clientErrors = validate();
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      setStatus("The form has errors. Fix the highlighted fields.");
      focusFirstError(clientErrors);
      return;
    }

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
        // Map the server's field issues back onto the form, then focus them.
        const fieldErrors: FieldErrors = {};
        for (const issue of extractIssues(payload)) {
          const field = fieldForIssuePath(issue.path);
          if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
        }
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          focusFirstError(fieldErrors);
          setStatus("");
          setSubmitting(false);
          return;
        }
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
      noValidate
      className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      <div>
        <label htmlFor="sched-title" className={labelClass}>
          Schedule title
          <RequiredMark />
        </label>
        <input
          ref={titleRef}
          id="sched-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "err-title" : undefined}
          placeholder="City Council Regular Session"
          className={inputClass}
        />
        {errors.title && (
          <p id="err-title" role="alert" className={errorClass}>
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="sched-body" className={labelClass}>
          Public body
          <RequiredMark />
        </label>
        <input
          ref={bodyRef}
          id="sched-body"
          type="text"
          required
          value={bodyName}
          onChange={(e) => setBodyName(e.target.value)}
          aria-invalid={errors.bodyName ? true : undefined}
          aria-describedby={errors.bodyName ? "err-body" : undefined}
          placeholder="Lawrence City Council"
          className={inputClass}
        />
        {errors.bodyName && (
          <p id="err-body" role="alert" className={errorClass}>
            {errors.bodyName}
          </p>
        )}
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
            <option value="course">Study Notes video</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="sched-url" className={labelClass}>
          {sourceType === "zoom" ? "Recurring Zoom link" : "Stream / video URL"}
          <RequiredMark />
        </label>
        <input
          ref={urlRef}
          id="sched-url"
          type="url"
          inputMode="url"
          required
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          aria-invalid={errors.sourceUrl ? true : undefined}
          aria-describedby={errors.sourceUrl ? "err-url" : "hint-url"}
          placeholder={
            sourceType === "zoom"
              ? "https://us02web.zoom.us/j/1234567890"
              : "https://www.youtube.com/@city/live"
          }
          className={inputClass}
        />
        {errors.sourceUrl ? (
          <p id="err-url" role="alert" className={errorClass}>
            {errors.sourceUrl}
          </p>
        ) : (
          <p id="hint-url" className="mt-2 text-sm text-ink-soft">
            Used for every occurrence. Tip: set the time a bit after the meeting
            to grab the posted recording (captions, no live timing).
          </p>
        )}
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
            <RequiredMark />
          </label>
          <input
            ref={tzRef}
            id="sched-tz"
            type="text"
            required
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-invalid={errors.timezone ? true : undefined}
            aria-describedby={errors.timezone ? "err-tz" : undefined}
            placeholder="America/Chicago"
            className={inputClass}
          />
          {errors.timezone && (
            <p id="err-tz" role="alert" className={errorClass}>
              {errors.timezone}
            </p>
          )}
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
