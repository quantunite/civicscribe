// Meeting detail page (server component). Fetches the full MeetingDetail via
// the store and hands it to the client-side MeetingView, which keeps polling
// while the processing pipeline runs.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import type { MeetingDetail, MeetingStatus, Utterance } from "@/lib/types";
import { MeetingView } from "@/components/meeting/MeetingView";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { isStaff } from "@/lib/auth/server";
import { getConfig } from "@/lib/config";
import { buildMeetingMetadata } from "@/lib/meetings/metadata";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<MeetingStatus, string> = {
  pending: "Pending",
  capturing: "Capturing",
  transcribing: "Transcribing",
  summarizing: "Summarizing",
  complete: "Complete",
  failed: "Failed",
};

const STATUS_STYLES: Record<MeetingStatus, string> = {
  pending: "bg-slate-100 text-slate-800 border-slate-300",
  capturing: "bg-amber-100 text-amber-900 border-amber-300",
  transcribing: "bg-sky-100 text-sky-900 border-sky-300",
  summarizing: "bg-violet-100 text-violet-900 border-violet-300",
  complete: "bg-teal-100 text-teal-900 border-teal-300",
  failed: "bg-red-100 text-red-900 border-red-300",
};

function StatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

async function loadDetail(id: string): Promise<MeetingDetail | null> {
  const store = getStore();
  const meeting = await store.getMeeting(id);
  if (!meeting) return null;
  const transcript = await store.getTranscriptByMeeting(meeting.id);
  const [utterances, summary] = await Promise.all([
    transcript
      ? store.listUtterances(transcript.id)
      : Promise.resolve<Utterance[]>([]),
    store.getSummaryByMeeting(meeting.id),
  ]);
  return { meeting, transcript, utterances, summary };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const store = getStore();
  const meeting = await store.getMeeting(id);

  // Reuse the same published/admin boundary the page enforces so a card never
  // leaks an unpublished meeting. Only fetch the summary when there is a
  // meeting (avoids a needless store read on a 404).
  const isAdmin = await isStaff();
  const summary =
    meeting && (meeting.published || isAdmin)
      ? await store.getSummaryByMeeting(meeting.id)
      : null;

  return buildMeetingMetadata({
    meeting,
    summary,
    isAdmin,
    baseUrl: getConfig().baseUrl,
  });
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadDetail(id);
  if (!detail) notFound();
  const { meeting } = detail;

  const isAdmin = await isStaff();

  // Published boundary: an unpublished (pending-review) meeting must not be
  // reachable by direct UUID for the public. 404 (notFound) rather than reveal
  // that it exists. Admins see the full detail.
  if (!meeting.published && !isAdmin) notFound();

  // The detail page's first crumb is the public Library: meetings shown here are
  // published (the only public path in), and admins still get a working trail.
  const crumbHome = meeting.kind === "course"
    ? { label: "Study Notes", href: "/study-notes" }
    : { label: "Library", href: "/library" };

  // <div>, not <main>: the root layout already renders the <main> landmark.
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[crumbHome, { label: meeting.title }]} />

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {meeting.title}
          </h1>
          <StatusBadge status={meeting.status} />
        </div>
        <p className="mt-2 text-lg leading-[1.7] text-slate-700">
          {meeting.body_name}
          {" · "}
          <time dateTime={meeting.created_at}>
            {formatDate(meeting.created_at)}
          </time>
          {meeting.duration_seconds != null && (
            <> · {formatDuration(meeting.duration_seconds)}</>
          )}
        </p>
      </header>

      <div className="mt-8">
        <MeetingView detail={detail} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
