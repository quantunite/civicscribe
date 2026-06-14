import Link from "next/link";

import { getStore } from "@/lib/store";
import ScheduleList from "@/components/schedules/ScheduleList";

// next_fire_at / last_fired_at advance as the sweep runs — render fresh.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schedules",
  description:
    "Auto-capture recurring meetings on a cadence. CivicScribe materializes and processes each occurrence for you.",
};

export default async function SchedulesPage() {
  const schedules = await getStore().listSchedules();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">Schedules</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Capture a recurring meeting automatically. Each occurrence becomes a
            meeting that&apos;s captured, transcribed, and summarized, with no
            need to add it by hand every week.
          </p>
        </div>
        <Link
          href="/schedules/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong"
        >
          New schedule
        </Link>
      </div>
      <ScheduleList initial={schedules} />
    </div>
  );
}
