// Public topics index (server component): the cross-meeting synthesis surface.
// Synthesis only adds value across multiple meetings, so this lists only topics
// that span 2 or more PUBLISHED meetings. listTopics() is published-only by
// construction, so nothing unpublished can surface here for anyone. This page
// never generates anything, so there is no admin branch and no LLM call.

import type { Metadata } from "next";
import Link from "next/link";

import { getStore } from "@/lib/store";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

// The published set + topic counts change as the admin curates; render fresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topics",
  description:
    "Cross-meeting topic syntheses: see how a topic was discussed across multiple published civic meetings.",
};

export default async function TopicsPage() {
  const topics = (await getStore().listTopics()).filter((t) => t.count >= 2);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumbs items={[{ label: "Topics" }]} />
        <h1 className="mt-4 text-3xl">Topics</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Topics that span more than one published meeting. Open a topic to read a
          synthesis of how it was discussed across those meetings.
        </p>
      </div>

      {topics.length === 0 ? (
        <p className="text-ink-soft">
          No topics span multiple meetings yet. Topics appear here as more
          meetings on the same subject are published.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/topics/${t.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-50 px-4 py-1.5 text-base font-medium text-teal-900 hover:bg-teal-100 hover:text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                <span>{t.topic}</span>
                <span
                  aria-label={`${t.count} meetings`}
                  className="rounded-full bg-teal-700 px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
                >
                  {t.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
