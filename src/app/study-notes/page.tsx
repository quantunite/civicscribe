import Link from "next/link";
import { getStore } from "@/lib/store";
import MeetingList from "@/components/dashboard/MeetingList";
import { isStaff } from "@/lib/auth/server";

// Statuses change as the worker runs, and the visible set depends on the
// per-request admin cookie, so always render fresh.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Study Notes",
  description:
    "Digest educational videos fast: paste a video, get study notes instead of watching.",
};

export default async function StudyNotesPage() {
  const isAdmin = await isStaff();

  // Public visitors see only published videos; admins see everything.
  const store = getStore();
  const videos = isAdmin
    ? await store.listMeetings("course")
    : await store.listLibrary({ kind: "course" });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">Study Notes</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Get up to speed on the policy, civic process, and energy topics
            behind the work. Paste an educational video, get the notes, skip the
            watch.
          </p>
        </div>
        <Link
          href="/study-notes/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong"
        >
          Add a video
        </Link>
      </div>
      <MeetingList initialMeetings={videos} kind="course" isAdmin={isAdmin} />
    </div>
  );
}
