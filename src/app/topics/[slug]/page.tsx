// Cross-meeting topic synthesis page (server component).
//
// COST SAFETY: generation is an LLM call that spends real money, so we pass
// { allowGenerate: isAdmin } to getOrBuildTopicSynthesis. A public / anonymous
// visitor (isAdmin=false) NEVER triggers generation: they see the cached
// synthesis if present, else a friendly "not generated yet" empty state. Only an
// admin request can generate (or refresh a stale) synthesis by viewing the page.

import type { Metadata } from "next";
import Link from "next/link";

import { getStore } from "@/lib/store";
import { getProviders } from "@/lib/providers";
import { isStaff } from "@/lib/auth/server";
import { getOrBuildTopicSynthesis } from "@/lib/topics/synthesis";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { LibraryMeetingGrid } from "@/components/library/LibraryMeetingGrid";
import { SynthesisMarkdown } from "@/components/topics/SynthesisMarkdown";

// Admin-cookie-dependent and curated-set-dependent, so always render fresh.
export const dynamic = "force-dynamic";

/** Turn a slug ("public-safety") into a readable heading ("Public safety").
 *  Best-effort: the original spelling is lossy-mapped. Used for metadata only,
 *  so generateMetadata does no store or provider work (and never generates). */
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
    title: `${label} · Topics`,
    description: `A cross-meeting synthesis of ${label} across published civic meetings.`,
  };
}

export default async function TopicSynthesisPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);

  const isAdmin = await isStaff();

  const result = await getOrBuildTopicSynthesis(
    getStore(),
    getProviders(),
    slug,
    { allowGenerate: isAdmin }
  );

  const meetings = result.meetings.map((r) => r.meeting);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumbs
          items={[{ label: "Topics", href: "/topics" }, { label: result.topic }]}
        />
        <h1 className="mt-4 text-3xl">{result.topic}</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {result.status === "too_few"
            ? "Need at least 2 published meetings on this topic."
            : `A synthesis across ${meetings.length} published meetings on this topic.`}
        </p>
        <p className="mt-3">
          <Link
            href={`/tags/${slug}`}
            className="rounded font-medium text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Browse all meetings tagged with this topic
          </Link>
        </p>
      </div>

      {result.status === "too_few" ? (
        <p className="text-ink-soft">
          When a second meeting on this topic is published, a cross-meeting
          synthesis will appear here.
        </p>
      ) : result.content ? (
        <section
          aria-labelledby="synthesis-heading"
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="synthesis-heading" className="sr-only">
            Cross-meeting synthesis
          </h2>
          <SynthesisMarkdown content={result.content} />
          {isAdmin && (
            <p className="mt-6 text-sm text-ink-soft">
              {result.status === "generated"
                ? "Viewing this page generated and cached the synthesis."
                : result.status === "fresh"
                  ? "This synthesis is up to date with the published meetings."
                  : "Showing the last cached synthesis."}
            </p>
          )}
        </section>
      ) : (
        <p className="text-ink-soft">
          A cross-meeting synthesis will appear here once an editor generates it.
        </p>
      )}

      <section aria-labelledby="contributing-heading">
        <h2 id="contributing-heading" className="text-2xl">
          Contributing meetings
        </h2>
        {meetings.length > 0 ? (
          <div className="mt-4">
            <LibraryMeetingGrid meetings={meetings} />
          </div>
        ) : (
          <p className="mt-3 text-ink-soft">
            No published meetings cover this topic yet.
          </p>
        )}
      </section>
    </div>
  );
}
