// Meeting detail page (server component). Fetches the full MeetingDetail via
// the store and hands it to the client-side MeetingView, which keeps polling
// while the processing pipeline runs.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import type { MeetingDetail, MeetingStatus, Utterance } from "@/lib/types";
import { MeetingView } from "@/components/meeting/MeetingView";

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
  const meeting = await getStore().getMeeting(id);
  return {
    title: meeting
      ? `${meeting.title} — CivicScribe`
      : "Meeting not found — CivicScribe",
  };
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
        <MeetingView detail={detail} />
      </div>
    </main>
  );
}
