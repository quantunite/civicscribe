import { cookies } from "next/headers";
import { getStore } from "@/lib/store";
import MeetingList from "@/components/dashboard/MeetingList";
import { OWNER_COOKIE, isAdminCookie } from "@/lib/owner";

// Always render fresh data: meeting statuses change as the worker runs, and
// the visible set depends on the per-request admin cookie.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const isAdmin = isAdminCookie(cookieStore.get(OWNER_COOKIE)?.value ?? null);

  // Public visitors see only the published library; admins see everything
  // (including pending and failed) so they can moderate from the dashboard.
  const store = getStore();
  const meetings = isAdmin
    ? await store.listMeetings("civic")
    : await store.listLibrary({ kind: "civic" });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl">Meetings</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {isAdmin
            ? "Your archive of captured public meetings. Processing meetings update automatically; completed ones open to a full transcript and summary."
            : "A public archive of captured meetings. Open any one for a full transcript and summary."}
        </p>
      </div>
      <MeetingList initialMeetings={meetings} kind="civic" isAdmin={isAdmin} />
    </div>
  );
}
