// Public topic browse (server component): every PUBLISHED meeting whose summary
// carries this topic slug, newest first. getTopicMeetings is published-only by
// construction, so an unpublished meeting can never surface here for anyone,
// admin or not. Reserved note: /topics is for Phase 3 synthesis; topic-tag
// browse lives under /tags.

import type { Metadata } from "next";

import { getStore } from "@/lib/store";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { LibraryMeetingGrid } from "@/components/library/LibraryMeetingGrid";

// The published set behind a slug changes as the admin curates; render fresh.
export const dynamic = "force-dynamic";

/** Turn a slug ("public-safety") into a readable heading ("Public safety").
 *  The original spelling is lossy-mapped, so this is a best-effort label. */
function slugToLabel(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const label = slugToLabel(decodeURIComponent(slug));
  return {
    title: `${label} · Library`,
    description: `Published civic meetings about ${label}.`,
  };
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const label = slugToLabel(slug);

  const rows = await getStore().getTopicMeetings(slug);
  const meetings = rows.map((r) => r.meeting);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumbs
          items={[
            { label: "Library", href: "/library" },
            { label },
          ]}
        />
        <h1 className="mt-4 text-3xl">{label}</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {meetings.length === 0
            ? "No published meetings cover this topic yet."
            : `${meetings.length} published ${
                meetings.length === 1 ? "meeting covers" : "meetings cover"
              } this topic.`}
        </p>
      </div>

      {meetings.length > 0 && <LibraryMeetingGrid meetings={meetings} />}
    </div>
  );
}
