// Public library landing (server component). The PUBLIC entry point into the
// shared civic-knowledge library: a topic cloud (chips from listTopics) plus a
// grid of published meetings (governing bodies). Everything here is
// published-only by construction — listTopics and listLibrary both filter to
// published — so there is no admin branch and nothing unpublished can leak.

import type { Metadata } from "next";
import Link from "next/link";

import { getStore } from "@/lib/store";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { LibraryMeetingGrid } from "@/components/library/LibraryMeetingGrid";
import { LiveNow } from "@/components/dashboard/LiveNow";

// Published set + topic counts change as the admin curates, so always render
// fresh rather than caching a stale library snapshot.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library",
  description:
    "Browse the public library of civic meetings: read, search, and cite speaker-labeled transcripts and summaries by topic and governing body.",
};

export default async function LibraryPage() {
  const store = getStore();
  const [topics, meetings] = await Promise.all([
    store.listTopics(),
    store.listLibrary(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Breadcrumbs items={[{ label: "Library" }]} />
        <h1 className="mt-4 text-3xl">Library</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          A public, searchable archive of civic business. Browse by topic or by
          meeting; open any one for a full transcript and summary.
        </p>
      </div>

      {/* Live now: meetings currently streaming public live captions. Renders
          nothing when none is live. */}
      <LiveNow />

      <section aria-labelledby="topics-cloud-heading">
        <h2 id="topics-cloud-heading" className="text-2xl">
          Browse by topic
        </h2>
        {topics.length === 0 ? (
          <p className="mt-3 text-ink-soft">
            Topics appear here as published meetings are added.
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {topics.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/tags/${t.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-50 px-4 py-1.5 text-base font-medium text-teal-900 hover:bg-teal-100 hover:text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                >
                  <span>{t.topic}</span>
                  <span
                    aria-label={`${t.count} ${
                      t.count === 1 ? "meeting" : "meetings"
                    }`}
                    className="rounded-full bg-teal-700 px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
                  >
                    {t.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="library-meetings-heading">
        <h2 id="library-meetings-heading" className="text-2xl">
          Published meetings
        </h2>
        {meetings.length === 0 ? (
          <p className="mt-3 text-ink-soft">
            No meetings have been published to the library yet. Check back soon.
          </p>
        ) : (
          <div className="mt-4">
            <LibraryMeetingGrid meetings={meetings} />
          </div>
        )}
      </section>
    </div>
  );
}
