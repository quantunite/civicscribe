import Link from "next/link";
import type { Meeting } from "@/lib/types";
import StatusBadge from "@/components/dashboard/StatusBadge";

const SOURCE_LABEL: Record<Meeting["source_type"], string> = {
  zoom: "Zoom capture",
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

export default function MeetingCard({ meeting }: { meeting: Meeting }) {
  const isComplete = meeting.status === "complete";

  const body = (
    <article className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
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

  if (isComplete) {
    return (
      <li className="h-full">
        <Link
          href={`/meetings/${meeting.id}`}
          aria-label={`${meeting.title} — open transcript and summary`}
          className={`${cardClass} transition-shadow hover:border-accent hover:shadow-md focus-visible:border-accent`}
        >
          {body}
        </Link>
      </li>
    );
  }

  return <li className={`${cardClass} h-full`}>{body}</li>;
}
