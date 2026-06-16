"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Meeting } from "@/lib/types";
import { formatDate } from "@/components/dashboard/MeetingCard";

/** Admin moderation queue: approve a generated meeting into the public library
 *  (publish) or remove it (delete). Renders the items handed in by the page; on
 *  a successful action it drops the item locally and refreshes the route. */
export default function ReviewQueue({ initial }: { initial: Meeting[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Meeting[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, path: string, method: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(path, { method });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((m) => m.id !== id));
      router.refresh();
    } catch {
      setError("That action did not go through. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-5 py-8 text-center text-ink-soft">
        Nothing waiting for review. Generated items show up here for approval
        before they appear in the public library.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-900"
        >
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((m) => {
          const busy = busyId === m.id;
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/meetings/${m.id}`}
                    className="text-lg font-semibold text-ink hover:text-accent"
                  >
                    {m.title}
                  </Link>
                  {m.publish_requested_at && (
                    <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent-strong">
                      Submitter requested
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-soft">
                  {m.body_name} (added {formatDate(m.created_at)})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(m.id, `/api/meetings/${m.id}/publish`, "POST")
                  }
                  className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-white shadow-sm hover:bg-accent-strong disabled:opacity-60"
                >
                  {busy ? "Working…" : "Publish"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(m.id, `/api/meetings/${m.id}`, "DELETE")}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface px-5 font-semibold text-ink hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
