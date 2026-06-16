// Live transcript page (server component, public). Renders the live caption
// stream for a meeting that opted into live transcription, with a popout window
// (?popout=1). After the meeting is published this redirects to the permanent
// meeting page (the published page is the authoritative record). Polling, not
// Supabase Realtime.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getStore } from "@/lib/store";
import { LiveTranscript } from "@/components/meeting/LiveTranscript";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live transcript",
};

export default async function LiveMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ popout?: string }>;
}) {
  const { id } = await params;
  const { popout } = await searchParams;

  const store = getStore();
  const meeting = await store.getMeeting(id);
  if (!meeting) notFound();

  // Once published, the permanent meeting page is the authoritative record.
  if (meeting.published) redirect(`/meetings/${id}`);

  // Live page only exists for meetings that opted into live captions.
  if (!meeting.live_enabled) notFound();

  const initial = await store.listLiveUtterances(id);

  // Seed the client with the true phase so the first paint matches reality
  // (no false "Live now" flash on an already-ended meeting, and no false
  // "Ended" before the bot has joined). published already redirected above and
  // a non-live meeting already 404'd, so this is waiting/live/ended-from-status.
  const initialPhase: "waiting" | "live" | "ended" =
    meeting.status === "capturing"
      ? "live"
      : meeting.status === "pending"
        ? "waiting"
        : "ended";

  return (
    <LiveTranscript
      meetingId={id}
      initial={initial}
      initialPhase={initialPhase}
      title={meeting.title}
      bodyName={meeting.body_name}
      popout={popout === "1"}
    />
  );
}
