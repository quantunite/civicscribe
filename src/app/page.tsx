import { getStore } from "@/lib/store";
import MeetingList from "@/components/dashboard/MeetingList";

// Always render fresh data — meeting statuses change as the worker runs.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const meetings = await getStore().listMeetings("civic");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl">Meetings</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Your archive of captured public meetings. Processing meetings update
          automatically — completed ones open to a full transcript and summary.
        </p>
      </div>
      <MeetingList initialMeetings={meetings} kind="civic" />
    </div>
  );
}
