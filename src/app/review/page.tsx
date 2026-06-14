import { getStore } from "@/lib/store";
import ReviewQueue from "@/components/owner/ReviewQueue";

// The queue changes as items are generated and approved; render fresh. Access
// to this page is gated by the edge middleware when OWNER_SECRET is set.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Moderation queue",
  description:
    "Review generated items and approve them into the public library.",
};

export default async function ReviewPage() {
  const pending = await getStore().listPendingReview();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl">Moderation queue</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Generated items are private until you approve them. Publish the ones
          worth keeping (they then appear in the public library) and delete the
          rest.
        </p>
      </div>
      <ReviewQueue initial={pending} />
    </div>
  );
}
