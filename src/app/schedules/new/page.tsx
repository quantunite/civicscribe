import type { Metadata } from "next";
import { cookies } from "next/headers";

import { OWNER_COOKIE, isAdminCookie } from "@/lib/owner";
import NewScheduleForm from "@/components/schedules/NewScheduleForm";

// The recurring controls are admin-only, so this reads the admin cookie per
// request and is never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New schedule",
  description:
    "Record a one-time capture at a future time, or set up a repeating capture. CivicScribe materializes and processes each occurrence automatically.",
};

export default async function NewSchedulePage() {
  const cookieStore = await cookies();
  const isAdmin = isAdminCookie(cookieStore.get(OWNER_COOKIE)?.value ?? null);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl">New schedule</h1>
      <p className="mt-2 text-ink-soft">
        Record a meeting you will miss at a chosen future time. CivicScribe will
        create and process a meeting for it: the same capture, transcription, and
        summary as adding one by hand.
      </p>
      <div className="mt-8">
        <NewScheduleForm isAdmin={isAdmin} />
      </div>
    </div>
  );
}
