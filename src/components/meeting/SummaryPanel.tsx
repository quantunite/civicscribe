// Summary panel for the meeting detail view. Renders the structured summary
// when present; while the pipeline is still running it shows an accessible
// live-updating progress note instead.

import type { MeetingKind, MeetingStatus, Summary } from "@/lib/types";
import { summaryLabels } from "@/lib/summary-labels";

const PROGRESS_NOTES: Partial<Record<MeetingStatus, string>> = {
  pending: "This meeting is queued for processing.",
  capturing: "Capturing the meeting audio…",
  transcribing: "Transcribing the audio with speaker identification…",
  summarizing: "Transcript ready. Writing the summary…",
};

interface SummaryPanelProps {
  summary: Summary | null;
  status: MeetingStatus;
  errorMessage: string | null;
  kind: MeetingKind;
}

export function SummaryPanel({
  summary,
  status,
  errorMessage,
  kind,
}: SummaryPanelProps) {
  const labels = summaryLabels(kind);

  if (!summary) {
    if (status === "failed") {
      return (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-5 text-lg leading-[1.7] text-red-900"
        >
          <strong className="font-semibold">Processing failed.</strong>{" "}
          {errorMessage ?? "No further detail was recorded."}
        </div>
      );
    }
    const note = PROGRESS_NOTES[status];
    if (note) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-lg leading-[1.7] text-slate-800 shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-teal-600"
          />
          <p>
            {note} This page updates automatically — no need to refresh.
          </p>
        </div>
      );
    }
    // Complete but no summary stored (shouldn't normally happen).
    return null;
  }

  return (
    <section
      aria-labelledby="summary-heading"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2
        id="summary-heading"
        className="text-xl font-bold tracking-tight text-slate-900"
      >
        Summary
      </h2>
      <p className="mt-3 text-lg leading-[1.7] text-slate-800">
        {summary.overview}
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="key-decisions-heading">
          <h3
            id="key-decisions-heading"
            className="text-sm font-bold uppercase tracking-wide text-teal-800"
          >
            {labels.keyPoints}
          </h3>
          {summary.key_decisions.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {summary.key_decisions.map((decision, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-lg leading-[1.7] text-slate-800"
                >
                  <span aria-hidden="true" className="mt-0.5 text-teal-700">
                    ✓
                  </span>
                  <span>{decision}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-lg leading-[1.7] text-slate-600">
              None recorded.
            </p>
          )}
        </section>

        <section aria-labelledby="action-items-heading">
          <h3
            id="action-items-heading"
            className="text-sm font-bold uppercase tracking-wide text-teal-800"
          >
            {labels.takeaways}
          </h3>
          {summary.action_items.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {summary.action_items.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-lg leading-[1.7] text-slate-800"
                >
                  <span aria-hidden="true" className="mt-0.5 text-teal-700">
                    →
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-lg leading-[1.7] text-slate-600">
              None recorded.
            </p>
          )}
        </section>
      </div>

      {summary.topics.length > 0 && (
        <section aria-labelledby="topics-heading" className="mt-6">
          <h3
            id="topics-heading"
            className="text-sm font-bold uppercase tracking-wide text-teal-800"
          >
            Topics
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {summary.topics.map((topic, i) => (
              <li
                key={i}
                className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-base font-medium text-slate-800"
              >
                {topic}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
