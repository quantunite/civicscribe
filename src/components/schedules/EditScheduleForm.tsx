"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Schedule } from "@/lib/types";
import { isInternalHost, meetingHostError, parseHttpUrl } from "@/lib/net/url";

const inputClass =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-sm placeholder:text-ink-soft/70";
const labelClass = "block font-semibold text-ink";
const errorClass = "mt-2 text-sm font-medium text-red-800";

interface FieldErrors {
  title?: string;
  bodyName?: string;
  sourceUrl?: string;
  when?: string;
}

/** ISO instant -> a `datetime-local` value in the browser's local zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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

/** Edit the fixable fields of a not-yet-started schedule. Source type and (for
 *  repeating schedules) the cadence are intentionally not editable here: change
 *  those by deleting and recreating. */
export default function EditScheduleForm({ schedule }: { schedule: Schedule }) {
  const router = useRouter();
  const [title, setTitle] = useState(schedule.title);
  const [bodyName, setBodyName] = useState(schedule.body_name);
  const [sourceUrl, setSourceUrl] = useState(schedule.source_spec.url);
  const [when, setWhen] = useState(
    schedule.one_off ? toLocalInput(schedule.next_fire_at) : ""
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "Enter a schedule title.";
    if (!bodyName.trim()) next.bodyName = "Enter the public body.";

    const url = parseHttpUrl(sourceUrl.trim());
    if (!sourceUrl.trim()) next.sourceUrl = "Enter the source URL.";
    else if (!url) next.sourceUrl = "Enter a full http:// or https:// URL.";
    else if (schedule.source_type !== "stream" && meetingHostError(schedule.source_type, url))
      next.sourceUrl = "Use a valid link for this platform.";
    else if (schedule.source_type === "stream" && isInternalHost(url.hostname))
      next.sourceUrl = "Use a public host: private addresses aren't allowed.";

    if (schedule.one_off) {
      if (!when.trim()) next.when = "Pick the date and time to capture.";
      else {
        const at = new Date(when);
        if (Number.isNaN(at.getTime())) next.when = "Enter a valid date and time.";
        else if (at.getTime() <= Date.now())
          next.when = "Pick a time in the future.";
      }
    }
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const clientErrors = validate();
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        body_name: bodyName.trim(),
        source_url: sourceUrl.trim(),
      };
      if (schedule.one_off) payload.next_fire_at = new Date(when).toISOString();

      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody: unknown = await res.json().catch(() => null);
        throw new Error(
          errorMessage(errBody) ?? `The update failed (error ${res.status}).`
        );
      }
      router.push("/schedules");
      router.refresh();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
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
        <label htmlFor="edit-title" className={labelClass}>
          Schedule title
        </label>
        <input
          id="edit-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          className={inputClass}
        />
        {errors.title && (
          <p role="alert" className={errorClass}>
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="edit-body" className={labelClass}>
          Public body
        </label>
        <input
          id="edit-body"
          type="text"
          value={bodyName}
          onChange={(e) => setBodyName(e.target.value)}
          aria-invalid={errors.bodyName ? true : undefined}
          className={inputClass}
        />
        {errors.bodyName && (
          <p role="alert" className={errorClass}>
            {errors.bodyName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="edit-url" className={labelClass}>
          {schedule.source_type === "stream" ? "Stream / video URL" : "Meeting link"}
        </label>
        <input
          id="edit-url"
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          aria-invalid={errors.sourceUrl ? true : undefined}
          className={inputClass}
        />
        {errors.sourceUrl && (
          <p role="alert" className={errorClass}>
            {errors.sourceUrl}
          </p>
        )}
        <p className="mt-2 text-sm text-ink-soft">
          Source type ({schedule.source_type}) can&apos;t be changed here. To
          change it, delete this schedule and create a new one.
        </p>
      </div>

      {schedule.one_off ? (
        <div>
          <label htmlFor="edit-when" className={labelClass}>
            Capture time
          </label>
          <input
            id="edit-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-invalid={errors.when ? true : undefined}
            className={inputClass}
          />
          {errors.when && (
            <p role="alert" className={errorClass}>
              {errors.when}
            </p>
          )}
          <p className="mt-2 text-sm text-ink-soft">
            The date and time to record, in your local time. Must be in the
            future.
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-line bg-primary-soft px-4 py-3 text-sm text-ink-soft">
          This is a repeating schedule. To change the cadence, delete it and
          create a new one.
        </p>
      )}

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
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <Link
          href="/schedules"
          className="inline-flex min-h-12 items-center rounded-md border border-line-strong px-5 font-semibold text-ink hover:bg-primary-soft"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
