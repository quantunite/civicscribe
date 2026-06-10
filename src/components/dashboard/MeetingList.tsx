"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Meeting } from "@/lib/types";
import MeetingCard from "@/components/dashboard/MeetingCard";
import { isProcessingStatus } from "@/components/dashboard/StatusBadge";

const POLL_INTERVAL_MS = 3000;

/**
 * Client-side meeting list. Receives server-rendered initial data, then polls
 * /api/meetings every 3 seconds while any meeting is still being processed
 * (pending / capturing / transcribing / summarizing). Polling stops on its
 * own once everything is complete or failed.
 */
export default function MeetingList({
  initialMeetings,
}: {
  initialMeetings: Meeting[];
}) {
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const hasProcessing = meetings.some((m) => isProcessingStatus(m.status));

  useEffect(() => {
    if (!hasProcessing) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/meetings", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Meeting[];
        if (!cancelled && Array.isArray(data)) {
          setMeetings(data);
        }
      } catch {
        // Transient network error — keep polling.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasProcessing]);

  if (meetings.length === 0) {
    return (
      <section
        aria-label="No meetings yet"
        className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center"
      >
        <h2 className="text-2xl">No meetings yet</h2>
        <p className="mx-auto mt-3 max-w-xl text-ink-soft">
          Add your first meeting to start building a searchable archive — paste
          a Zoom link, a public stream URL, or upload a recording.
        </p>
        <div className="mt-6 flex flex-col items-center gap-4">
          <Link
            href="/meetings/new"
            className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-6 font-semibold text-white shadow-sm hover:bg-accent-strong"
          >
            Add a meeting
          </Link>
          <p className="text-sm text-ink-soft">
            Or run{" "}
            <code className="rounded bg-primary-soft px-2 py-1 font-mono text-sm text-primary-strong">
              npm run seed
            </code>{" "}
            to load two example meetings.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {hasProcessing
          ? "Some meetings are still processing. This list updates automatically."
          : "All meetings have finished processing."}
      </p>
      <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {meetings.map((meeting) => (
          <MeetingCard key={meeting.id} meeting={meeting} />
        ))}
      </ul>
    </>
  );
}
