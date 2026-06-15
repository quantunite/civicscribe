"use client";

import { useState } from "react";
import Link from "next/link";
import type { Meeting } from "@/lib/types";
import StatusBadge from "@/components/dashboard/StatusBadge";

const SOURCE_LABEL: Record<Meeting["source_type"], string> = {
  zoom: "Zoom capture",
  teams: "Teams capture",
  meet: "Google Meet capture",
  stream: "Stream capture",
  upload: "Uploaded file",
};

/** "42:17 min" under an hour, "1:23 hr" at an hour or more. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 1) {
    return `${h}:${String(m).padStart(2, "0")} hr`;
  }
  return `${m}:${String(s).padStart(2, "0")} min`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function MeetingCard({
  meeting,
  onDeleted,
  isAdmin = false,
}: {
  meeting: Meeting;
  onDeleted: (id: string) => void;
  isAdmin?: boolean;
}) {
  const isComplete = meeting.status === "complete";
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setError(false);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      onDeleted(meeting.id);
    } catch {
      setError(true);
      setDeleting(false);
    }
  }

  const body = (
    <article className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 pr-9">
        <h2 className="text-xl leading-snug">{meeting.title}</h2>
        <StatusBadge status={meeting.status} />
      </div>
      <p className="font-medium text-primary">{meeting.body_name}</p>
      <dl className="mt-auto flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
        <div className="flex gap-2">
          <dt>Date</dt>
          <dd className="font-semibold text-ink">{formatDate(meeting.created_at)}</dd>
        </div>
        {meeting.duration_seconds !== null && (
          <div className="flex gap-2">
            <dt>Duration</dt>
            <dd className="font-semibold text-ink">
              {formatDuration(meeting.duration_seconds)}
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="sr-only">Source</dt>
          <dd>{SOURCE_LABEL[meeting.source_type]}</dd>
        </div>
      </dl>
      {meeting.status === "failed" && meeting.error_message && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          <span className="font-bold">Processing failed:</span>{" "}
          {meeting.error_message}
        </p>
      )}
      {isComplete && (
        <p className="text-sm font-semibold text-accent" aria-hidden="true">
          View transcript &amp; summary →
        </p>
      )}
    </article>
  );

  const cardClass =
    "block h-full rounded-xl border border-line bg-surface p-5 shadow-sm";

  // The card is a single wrapping anchor; the delete control is a SIBLING of
  // the anchor (absolutely positioned), never nested inside it, so the markup
  // stays valid and both targets are independently focusable/clickable.
  return (
    <li className="relative h-full">
      <Link
        href={`/meetings/${meeting.id}`}
        aria-label={
          isComplete
            ? `${meeting.title}: open transcript and summary`
            : `${meeting.title}: view status and details`
        }
        className={`${cardClass} transition-shadow hover:border-accent hover:shadow-md focus-visible:border-accent`}
      >
        {body}
      </Link>

      {isAdmin && (
      <div className="absolute right-2 top-2 z-10">
        {confirming ? (
          <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-surface p-1 shadow-md">
            <span className="px-1 text-sm font-medium text-ink">
              {error ? "Failed, retry?" : "Delete?"}
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label={`Confirm delete ${meeting.title}`}
              className="rounded-md bg-red-700 px-2 py-1 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            >
              {deleting ? "…" : "Yes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(false);
              }}
              disabled={deleting}
              aria-label="Cancel delete"
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink hover:bg-primary-soft disabled:opacity-60"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${meeting.title}`}
            title="Delete meeting"
            className="rounded-md border border-line bg-surface/90 p-1.5 text-ink-soft shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6m3 5v6m4-6v6" />
            </svg>
          </button>
        )}
      </div>
      )}
    </li>
  );
}
