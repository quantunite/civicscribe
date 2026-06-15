// Read-only published-meeting grid for the public library + tag pages. Unlike
// the operator dashboard's MeetingList (a client component that polls + offers
// delete), these meetings are already published and public, so the grid is a
// static server component: a wrapping <Link> card per meeting, no delete
// control, no polling. Visual styling mirrors MeetingCard so the two surfaces
// feel like one product.

import Link from "next/link";

import type { Meeting } from "@/lib/types";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { formatDate, formatDuration } from "@/components/dashboard/MeetingCard";

const SOURCE_LABEL: Record<Meeting["source_type"], string> = {
  zoom: "Zoom capture",
  teams: "Teams capture",
  meet: "Google Meet capture",
  stream: "Stream capture",
  upload: "Uploaded file",
};

export function LibraryMeetingGrid({ meetings }: { meetings: Meeting[] }) {
  return (
    <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {meetings.map((meeting) => (
        <li key={meeting.id} className="h-full">
          <Link
            href={`/meetings/${meeting.id}`}
            aria-label={`${meeting.title}: open transcript and summary`}
            className="block h-full rounded-xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:border-accent hover:shadow-md focus-visible:border-accent"
          >
            <article className="flex h-full flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-xl leading-snug">{meeting.title}</h2>
                {meeting.kind === "course" && (
                  <span className="inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-3 py-0.5 text-sm font-semibold text-indigo-800">
                    Study Notes
                  </span>
                )}
                {meeting.kind !== "course" && (
                  <StatusBadge status={meeting.status} />
                )}
              </div>
              <p className="font-medium text-primary">{meeting.body_name}</p>
              <dl className="mt-auto flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
                <div className="flex gap-2">
                  <dt>Date</dt>
                  <dd className="font-semibold text-ink">
                    {formatDate(meeting.created_at)}
                  </dd>
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
              <p className="text-sm font-semibold text-accent" aria-hidden="true">
                View transcript &amp; summary →
              </p>
            </article>
          </Link>
        </li>
      ))}
    </ul>
  );
}
