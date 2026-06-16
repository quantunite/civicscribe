// Self-serve result page (thin server component). It renders NO unpublished
// content server-side: it only passes the meeting id to the client, which holds
// the single-meeting VIEW token in this tab's sessionStorage and reads the
// detail through GET /api/meetings/[id] with the x-cs-view header. This keeps the
// private preview out of any server-rendered HTML, caches, or shareable URL.

import type { Metadata } from "next";
import { SelfServeResult } from "@/components/meeting/SelfServeResult";

export const dynamic = "force-dynamic";

// Private, ephemeral preview: keep it out of search engines and crawlers.
export const metadata: Metadata = {
  title: "Your private preview",
  robots: { index: false, follow: false },
};

export default async function SelfServeResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <SelfServeResult meetingId={id} />
    </div>
  );
}
