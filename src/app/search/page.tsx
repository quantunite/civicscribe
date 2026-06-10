// Global full-text search across all meetings (server component). Results
// are grouped by meeting; each snippet deep-links to the utterance on the
// meeting detail page (#u-<utteranceId>), which scrolls to and highlights it.

import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store";
import type { UtteranceSearchResult } from "@/lib/types";
import {
  formatTimestamp,
  HighlightedText,
  speakerColor,
  speakerDisplayName,
  tokenize,
} from "@/components/meeting/transcript-utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search — CivicScribe",
};

interface MeetingGroup {
  meeting: UtteranceSearchResult["meeting"];
  items: UtteranceSearchResult[];
}

function groupByMeeting(results: UtteranceSearchResult[]): MeetingGroup[] {
  const byId = new Map<string, MeetingGroup>();
  const groups: MeetingGroup[] = [];
  for (const result of results) {
    let group = byId.get(result.meeting.id);
    if (!group) {
      group = { meeting: result.meeting, items: [] };
      byId.set(result.meeting.id, group);
      groups.push(group);
    }
    group.items.push(result);
  }
  return groups;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = raw?.trim() ?? "";

  const results = q
    ? await getStore().searchUtterances(q, { limit: 200 })
    : [];
  const groups = groupByMeeting(results);
  const tokens = tokenize(q);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="rounded text-lg font-medium text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          ← All meetings
        </Link>
      </nav>

      <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900">
        Search transcripts
      </h1>

      <form method="GET" action="/search" role="search" className="mt-6">
        <label
          htmlFor="q"
          className="block text-base font-semibold text-slate-800"
        >
          Search every meeting transcript
        </label>
        <div className="mt-2 flex flex-wrap gap-3">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="e.g. zoning variance, budget amendment…"
            className="w-full max-w-xl rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-lg text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          />
          <button
            type="submit"
            className="rounded-lg bg-teal-700 px-5 py-2.5 text-lg font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Search
          </button>
        </div>
      </form>

      <section aria-label="Search results" className="mt-8">
        {q === "" ? (
          <p className="text-lg leading-[1.7] text-slate-600">
            Enter a word or phrase to search across all meeting transcripts.
          </p>
        ) : results.length === 0 ? (
          <p className="text-lg leading-[1.7] text-slate-700">
            No utterances matched{" "}
            <strong className="font-semibold">&ldquo;{q}&rdquo;</strong>. Try a
            different word or a shorter phrase.
          </p>
        ) : (
          <>
            <p className="text-lg leading-[1.7] text-slate-700">
              {results.length} matching utterance
              {results.length === 1 ? "" : "s"} in {groups.length} meeting
              {groups.length === 1 ? "" : "s"} for{" "}
              <strong className="font-semibold">&ldquo;{q}&rdquo;</strong>.
            </p>

            <div className="mt-6 flex flex-col gap-8">
              {groups.map((group) => (
                <section
                  key={group.meeting.id}
                  aria-labelledby={`meeting-${group.meeting.id}-heading`}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <h2
                    id={`meeting-${group.meeting.id}-heading`}
                    className="text-xl font-bold tracking-tight"
                  >
                    <Link
                      href={`/meetings/${group.meeting.id}`}
                      className="rounded text-slate-900 underline decoration-teal-300 underline-offset-4 hover:text-teal-900 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      {group.meeting.title}
                    </Link>
                  </h2>
                  <p className="mt-1 text-base text-slate-600">
                    {group.meeting.body_name}
                    {" · "}
                    <time dateTime={group.meeting.created_at}>
                      {formatDate(group.meeting.created_at)}
                    </time>
                  </p>

                  <ul className="mt-4 divide-y divide-slate-100">
                    {group.items.map(({ utterance }) => {
                      const color = speakerColor(utterance.speaker_label);
                      return (
                        <li key={utterance.id}>
                          <Link
                            href={`/meetings/${group.meeting.id}#u-${utterance.id}`}
                            className="block rounded-lg px-3 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                          >
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-mono text-base font-medium tabular-nums text-teal-800">
                                {formatTimestamp(utterance.start_ms)}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-3 py-0.5 text-base font-semibold ${color.chip}`}
                              >
                                {speakerDisplayName(
                                  utterance.speaker_name,
                                  utterance.speaker_label
                                )}
                              </span>
                            </span>
                            <span className="mt-1.5 block text-lg leading-[1.7] text-slate-900">
                              <HighlightedText
                                text={utterance.text}
                                tokens={tokens}
                              />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
