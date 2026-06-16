"use client";

// The private, ephemeral, VIEW-ONLY self-serve result for the person who just
// submitted a meeting. It reads the single-meeting VIEW token from this tab's
// sessionStorage (cs-view:<id>), polls GET /api/meetings/[id] with the token in
// the x-cs-view header, shows processing status, then the transcript + summary
// to read in the moment. There is intentionally NO download, NO export, and NO
// email here: the only durable, shareable copy is the staff-approved public
// record, so the primary action is "Add this to the public record".

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MeetingDetail, MeetingStatus, Utterance } from "@/lib/types";
import { SummaryPanel } from "@/components/meeting/SummaryPanel";
import { TranscriptList } from "@/components/meeting/TranscriptList";
import {
  matchesAllTokens,
  tokenize,
} from "@/components/meeting/transcript-utils";

const VIEW_HEADER = "x-cs-view";

const PROCESSING_STATUSES: ReadonlySet<MeetingStatus> = new Set<MeetingStatus>([
  "pending",
  "capturing",
  "transcribing",
  "summarizing",
]);

type PublishState = "idle" | "submitting" | "done";

export function SelfServeResult({ meetingId }: { meetingId: string }) {
  // Read the view token once, on mount, from this tab's sessionStorage. null =
  // no token in this tab (closed/expired/never created here) -> show the
  // friendly "preview not available" copy rather than a bare 404.
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  // Distinguish "still loading the first response" from "loaded, no access".
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");

  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.sessionStorage.getItem(`cs-view:${meetingId}`));
    } catch {
      setToken(null);
    }
    setTokenChecked(true);
  }, [meetingId]);

  const status = detail?.meeting.status ?? null;
  const isProcessing = status !== null && PROCESSING_STATUSES.has(status);

  // Build the headers for a detail read. In open mode there is no token; the
  // detail API is open then, so an absent header still works.
  const fetchDetail = useCallback(async (): Promise<MeetingDetail | null> => {
    const headers: Record<string, string> = { };
    if (token) headers[VIEW_HEADER] = token;
    const res = await fetch(`/api/meetings/${meetingId}`, {
      cache: "no-store",
      headers,
    });
    if (!res.ok) return null;
    return (await res.json()) as MeetingDetail;
  }, [meetingId, token]);

  // Initial load + poll while processing. Runs only after we have checked for a
  // token (so open mode, token === null, still loads).
  useEffect(() => {
    if (!tokenChecked) return;
    let cancelled = false;

    const load = async () => {
      try {
        const next = await fetchDetail();
        if (cancelled) return;
        if (!next) {
          setLoadError(true);
          return;
        }
        setLoadError(false);
        setDetail(next);
      } catch {
        // Transient: leave prior state, the interval retries.
      }
    };

    void load();
    const interval = setInterval(() => {
      // Stop polling once the meeting is no longer processing.
      if (detail && !PROCESSING_STATUSES.has(detail.meeting.status)) return;
      void load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tokenChecked, fetchDetail, detail]);

  const tokens = useMemo(() => tokenize(query), [query]);
  const filtered = useMemo<Utterance[]>(() => {
    const all = detail?.utterances ?? [];
    return tokens.length === 0
      ? all
      : all.filter((u) => matchesAllTokens(u.text, tokens));
  }, [detail, tokens]);

  const handleRequestPublish = useCallback(async () => {
    setPublishState("submitting");
    setPublishError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers[VIEW_HEADER] = token;
      const res = await fetch(
        `/api/meetings/${meetingId}/request-publish`,
        { method: "POST", headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPublishState("done");
    } catch {
      setPublishState("idle");
      setPublishError(
        "We could not submit this for the public record. Try again."
      );
    }
  }, [meetingId, token]);

  // A no-op-equivalent seek: this view-only surface never mounts an audio
  // player, so the transcript timestamps are not clickable seeks.
  const noopSeek = useCallback(() => {}, []);

  // -- render states --------------------------------------------------------

  // Friendly "not available" when there is no token in this tab AND the open
  // detail read also failed (so the meeting is genuinely not viewable here).
  const previewUnavailable = tokenChecked && token === null && loadError;
  // With a token but the read still failed (expired/revoked token, deleted
  // meeting): same honest copy.
  const accessDenied = tokenChecked && token !== null && loadError && !detail;

  if (previewUnavailable || accessDenied) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl">This preview is not available</h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          This private preview has expired or is not available. If you submitted
          this meeting, it will appear in the public library once staff approve
          it.
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
      >
        <h1 className="text-2xl">Preparing your preview</h1>
        <p className="mt-3 text-ink-soft">Loading…</p>
      </section>
    );
  }

  const { meeting } = detail;
  const hasTranscript = detail.utterances.length > 0;
  const diarized = detail.transcript?.diarized ?? true;
  const failed = meeting.status === "failed";

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">
          Private preview
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          {meeting.title}
        </h1>
        <p className="mt-2 text-lg leading-[1.7] text-slate-700">
          {meeting.body_name}
        </p>
        <p className="mt-3 max-w-2xl text-base leading-[1.7] text-ink-soft">
          This preview is private, temporary, and view-only. To keep it or share
          it, add it to the public record. After staff approve it, the public
          library is the lasting copy.
        </p>
      </header>

      {/* Primary action: add to the public record. */}
      <section
        aria-label="Add to the public record"
        className="rounded-xl border border-line bg-primary-soft p-6 shadow-sm"
      >
        {publishState === "done" ? (
          <p role="status" className="text-lg leading-[1.7] text-ink">
            Submitted for the public record. Staff will review it before it
            appears in the public library.
          </p>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-ink">
              Keep this on the public record
            </h2>
            <p className="mt-2 max-w-2xl text-base leading-[1.7] text-ink-soft">
              Adding it asks staff to review and publish it to the public
              library. That published copy is the lasting, shareable version.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void handleRequestPublish()}
                disabled={publishState === "submitting"}
                className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-7 text-lg font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {publishState === "submitting"
                  ? "Submitting…"
                  : "Add this to the public record"}
              </button>
              {publishError && (
                <p role="alert" className="text-sm font-medium text-red-800">
                  {publishError}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {failed ? (
        <section
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-5 text-lg leading-[1.7] text-red-900"
        >
          <strong className="font-semibold">
            We could not produce a transcript.
          </strong>{" "}
          Something went wrong while processing this recording. You can try
          submitting it again.
        </section>
      ) : (
        <SummaryPanel
          summary={detail.summary}
          status={meeting.status}
          // Do not surface the raw error_message on this public-facing preview.
          errorMessage={null}
          kind={meeting.kind}
        />
      )}

      {!failed && (
        <section aria-labelledby="transcript-heading">
          <h2
            id="transcript-heading"
            className="text-xl font-bold tracking-tight text-slate-900"
          >
            Transcript
          </h2>

          {hasTranscript && !diarized && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              From auto-captions, no speaker labels
            </p>
          )}

          {!hasTranscript ? (
            <p
              aria-live="polite"
              className="mt-3 rounded-xl border border-slate-200 bg-white p-6 text-lg leading-[1.7] text-slate-600"
            >
              {isProcessing
                ? "The transcript will appear here as soon as transcription finishes. This page updates automatically, no need to refresh."
                : "No transcript is available yet."}
            </p>
          ) : (
            <>
              <div className="mt-3 mb-3">
                <label
                  htmlFor="transcript-search"
                  className="block text-base font-semibold text-slate-800"
                >
                  Search this transcript
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <input
                    id="transcript-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter utterances…"
                    className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  />
                  <p role="status" aria-live="polite" className="text-base text-slate-700">
                    {tokens.length > 0
                      ? `${filtered.length} of ${detail.utterances.length} utterances`
                      : `${detail.utterances.length} utterances`}
                  </p>
                </div>
              </div>

              {/* Read-only: no onRename (no speaker editing), no canCite
                  (citations are a published affordance), and no audio seek. */}
              <TranscriptList
                utterances={filtered}
                tokens={tokens}
                diarized={diarized}
                onSeek={noopSeek}
                meetingId={meeting.id}
                canCite={false}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
