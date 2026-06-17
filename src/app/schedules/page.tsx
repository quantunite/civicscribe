import Link from "next/link";

import { getStore } from "@/lib/store";
import { isStaff } from "@/lib/auth/server";
import ScheduleList from "@/components/schedules/ScheduleList";
import type { Meeting } from "@/lib/types";

// next_fire_at / last_fired_at advance as the sweep runs — render fresh.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schedules",
  description:
    "Record a one-time capture at a future time, or set up a repeating capture. CivicScribe materializes and processes each occurrence for you.",
};

export default async function SchedulesPage() {
  const isAdmin = await isStaff();
  const store = getStore();
  const schedules = await store.listSchedules();

  // The most recent meeting each schedule has materialized, so the list can
  // show "you scheduled it, here's what the capture actually produced" — the
  // missing link between a fired schedule and its (possibly failed) meeting.
  const latestById: Record<string, Meeting> = {};
  await Promise.all(
    schedules.map(async (s) => {
      const meetings = await store.listMeetingsBySchedule(s.id);
      if (meetings[0]) latestById[s.id] = meetings[0];
    })
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">Schedules</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Record a meeting you will miss at a chosen future time, or set up a
            repeating capture. Each one becomes a meeting that is captured,
            transcribed, and summarized for you.
          </p>
        </div>
        <Link
          href="/schedules/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong"
        >
          New schedule
        </Link>
      </div>
      <ScheduleList
        initial={schedules}
        latestCaptures={latestById}
        isAdmin={isAdmin}
      />
    </div>
  );
}
