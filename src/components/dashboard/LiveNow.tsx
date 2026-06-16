// "Live now" feed (server component, public). Lists meetings that opted into
// live captions and are currently being captured, each linking to its public
// live-transcript page. Renders nothing when no meeting is live, so it is safe
// to drop near the top of any page.

import Link from "next/link";

import { getStore } from "@/lib/store";

export async function LiveNow() {
  const meetings = await getStore().listLiveMeetings();
  if (meetings.length === 0) return null;

  return (
    <section
      aria-labelledby="live-now-heading"
      className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600"
        />
        <h2
          id="live-now-heading"
          className="text-sm font-semibold uppercase tracking-wide text-red-800"
        >
          Live now
        </h2>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Link
              href={`/meetings/${meeting.id}/live`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-4 py-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                <span aria-hidden="true">●</span> Live
              </span>
              <span className="font-semibold text-ink">{meeting.title}</span>
              <span className="text-sm text-ink-soft">{meeting.body_name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
