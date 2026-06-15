import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getStore } from "@/lib/store";
import { isStaff } from "@/lib/auth/server";
import { isScheduleEditable } from "@/lib/schedule/editable";
import EditScheduleForm from "@/components/schedules/EditScheduleForm";

export const metadata: Metadata = {
  title: "Edit schedule",
};

export const dynamic = "force-dynamic";

export default async function EditSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Editing is staff-only. The page is reachable, but it gates here (the PATCH
  // API is gated too) so a non-staff visitor gets a clear sign-in prompt.
  if (!(await isStaff())) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-3xl">Sign in to edit</h1>
        <p className="mt-2 text-ink-soft">
          Editing schedules is for moderators and admins.{" "}
          <Link
            href={`/login?next=/schedules/${id}/edit`}
            className="font-semibold text-accent-strong underline"
          >
            Sign in
          </Link>{" "}
          to continue.
        </p>
      </div>
    );
  }

  const schedule = await getStore().getSchedule(id);
  if (!schedule) notFound();

  const editable = isScheduleEditable(schedule.next_fire_at, Date.now());

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl">Edit schedule</h1>
      <p className="mt-2 text-ink-soft">
        Fix a mistake before the capture runs, no need to make a new entry.
      </p>
      <div className="mt-8">
        {editable ? (
          <EditScheduleForm schedule={schedule} />
        ) : (
          <p className="rounded-xl border border-line bg-surface p-8 text-ink-soft">
            This schedule has already started or run, so it can no longer be
            edited. Pause or delete it from{" "}
            <Link href="/schedules" className="font-semibold text-accent-strong underline">
              Schedules
            </Link>{" "}
            instead.
          </p>
        )}
      </div>
    </div>
  );
}
