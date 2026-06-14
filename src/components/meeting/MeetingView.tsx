"use client";

// Client orchestrator for the meeting detail page: summary panel, sticky
// transcript search, virtualized transcript, speaker rename + apply-to-all
// flow, and the bottom-pinned audio player. While the pipeline is still
// running it polls GET /api/meetings/[id] every 3 seconds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingDetail, MeetingStatus, Utterance } from "@/lib/types";
import { SummaryPanel } from "@/components/meeting/SummaryPanel";
import { TranscriptList } from "@/components/meeting/TranscriptList";
import {
  AudioPlayer,
  type AudioPlayerHandle,
} from "@/components/meeting/AudioPlayer";
import {
  matchesAllTokens,
  tokenize,
} from "@/components/meeting/transcript-utils";

const PROCESSING_STATUSES: ReadonlySet<MeetingStatus> = new Set<MeetingStatus>([
  "pending",
  "capturing",
  "transcribing",
  "summarizing",
]);

interface PendingApply {
  speaker_label: string;
  display_name: string;
}

export function MeetingView({
  detail: initial,
  isAdmin = false,
}: {
  detail: MeetingDetail;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MeetingDetail>(initial);
  const [query, setQuery] = useState("");
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const audioRef = useRef<AudioPlayerHandle | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const status = detail.meeting.status;
  const isProcessing = PROCESSING_STATUSES.has(status);

  // Last status the poll loop observed. A ref (not the closure-captured
  // `status`) so transitions within the processing set are detected exactly
  // once without re-creating the interval.
  const lastStatusRef = useRef<MeetingStatus>(status);

  // Poll while the pipeline is running so the page updates live.
  useEffect(() => {
    if (!isProcessing) return;
    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/meetings/${detail.meeting.id}`, {
            cache: "no-store",
          });
          if (!res.ok || cancelled) return;
          const next = (await res.json()) as MeetingDetail;
          if (cancelled) return;
          const prevStatus = lastStatusRef.current;
          lastStatusRef.current = next.meeting.status;
          setDetail(next);
          if (next.meeting.status !== prevStatus) {
            // Any status transition (capturing -> transcribing ->
            // summarizing -> complete/failed): refresh the server-rendered
            // header so the status badge up top tracks live.
            router.refresh();
          }
        } catch {
          // Transient network error — try again on the next tick.
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isProcessing, detail.meeting.id, router]);

  // Client-side transcript filtering: case-insensitive, all tokens must match.
  const tokens = useMemo(() => tokenize(query), [query]);
  const filtered = useMemo<Utterance[]>(
    () =>
      tokens.length === 0
        ? detail.utterances
        : detail.utterances.filter((u) => matchesAllTokens(u.text, tokens)),
    [detail.utterances, tokens]
  );

  const handleSeek = useCallback((ms: number) => {
    audioRef.current?.seek(ms);
  }, []);

  // Single-utterance rename: PATCH, update local row, then offer apply-to-all.
  const handleRename = useCallback(
    async (utteranceId: string, name: string) => {
      const res = await fetch(`/api/utterances/${utteranceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker_name: name }),
      });
      if (!res.ok) {
        throw new Error(`Could not save the name (HTTP ${res.status})`);
      }
      const updated = (await res.json()) as Utterance;
      setDetail((prev) => ({
        ...prev,
        utterances: prev.utterances.map((u) =>
          u.id === updated.id ? { ...u, speaker_name: updated.speaker_name } : u
        ),
      }));
      setPendingApply({
        speaker_label: updated.speaker_label,
        display_name: updated.speaker_name ?? name,
      });
      setApplyError(null);
    },
    []
  );

  const handleApplyAll = useCallback(async () => {
    if (!pendingApply) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/meetings/${detail.meeting.id}/speakers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingApply),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { speaker_label, display_name } = pendingApply;
      setDetail((prev) => ({
        ...prev,
        utterances: prev.utterances.map((u) =>
          u.speaker_label === speaker_label
            ? { ...u, speaker_name: display_name }
            : u
        ),
      }));
      setPendingApply(null);
    } catch (err) {
      setApplyError(
        err instanceof Error
          ? `Could not apply to all utterances (${err.message}).`
          : "Could not apply to all utterances."
      );
    } finally {
      setApplying(false);
    }
  }, [pendingApply, detail.meeting.id]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/meetings/${detail.meeting.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? `Could not delete the meeting (${err.message}).`
          : "Could not delete the meeting."
      );
      setDeleting(false);
    }
  }, [detail.meeting.id, router]);

  const hasTranscript = detail.utterances.length > 0;
  // Caption-sourced transcripts have no speaker labels and no audio.
  const diarized = detail.transcript?.diarized ?? true;

  return (
    <div className="flex flex-col gap-8">
      {detail.meeting.kind === "course" && (
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800">
          Crash Course
        </p>
      )}
      <SummaryPanel
        summary={detail.summary}
        status={status}
        errorMessage={detail.meeting.error_message}
        kind={detail.meeting.kind}
      />

      {hasTranscript && (
        <section
          aria-label="Download transcript"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-base font-semibold text-slate-800">
            Download:
          </span>
          {[
            { fmt: "txt", label: "Text" },
            { fmt: "md", label: "Markdown" },
            { fmt: "srt", label: "Subtitles" },
            { fmt: "json", label: "JSON" },
          ].map(({ fmt, label }) => (
            <a
              key={fmt}
              href={`/api/meetings/${detail.meeting.id}/export?format=${fmt}`}
              download
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-base font-semibold text-teal-800 hover:bg-teal-50 hover:text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {label}
            </a>
          ))}
        </section>
      )}

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
              ? "The transcript will appear here as soon as transcription finishes."
              : "No transcript is available for this meeting."}
          </p>
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-1 bg-slate-50/95 px-1 py-3 backdrop-blur">
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
                <p
                  role="status"
                  aria-live="polite"
                  className="text-base text-slate-700"
                >
                  {tokens.length > 0
                    ? `${filtered.length} of ${detail.utterances.length} utterances`
                    : `${detail.utterances.length} utterances`}
                </p>
              </div>
            </div>

            <TranscriptList
              utterances={filtered}
              tokens={tokens}
              diarized={diarized}
              onSeek={handleSeek}
              onRename={isAdmin ? handleRename : undefined}
              meetingId={detail.meeting.id}
              canCite={detail.meeting.published || isAdmin}
            />
          </>
        )}
      </section>

      {isAdmin && (
      <section
        aria-label="Delete meeting"
        className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-6"
      >
        {confirmingDelete ? (
          <>
            <span className="text-base font-medium text-slate-900">
              Delete this meeting and its transcript and summary? This cannot be
              undone.
            </span>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-lg bg-red-700 px-4 py-1.5 text-base font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                setDeleteError(null);
              }}
              disabled={deleting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-base font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-lg border border-red-300 bg-white px-4 py-1.5 text-base font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            Delete meeting
          </button>
        )}
        {deleteError && (
          <p role="alert" className="text-base font-medium text-red-700">
            {deleteError}
          </p>
        )}
      </section>
      )}

      <div className="sticky bottom-0 z-20">
        {pendingApply && (
          <div
            role="region"
            aria-live="polite"
            aria-label="Apply speaker name to all utterances"
            className="flex flex-wrap items-center gap-3 border-t border-teal-200 bg-teal-50/95 px-4 py-3 backdrop-blur"
          >
            <p className="text-lg leading-[1.7] text-slate-900">
              Apply &ldquo;{pendingApply.display_name}&rdquo; to all utterances
              by Speaker {pendingApply.speaker_label}?
            </p>
            <button
              type="button"
              onClick={() => void handleApplyAll()}
              disabled={applying}
              className="rounded-lg bg-teal-700 px-4 py-1.5 text-base font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {applying ? "Applying…" : "Apply to all"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingApply(null);
                setApplyError(null);
              }}
              disabled={applying}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-base font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              No, just this one
            </button>
            {applyError && (
              <p role="alert" className="text-base font-medium text-red-700">
                {applyError}
              </p>
            )}
          </div>
        )}

        {detail.meeting.audio_storage_path && (
          <AudioPlayer
            ref={audioRef}
            src={`/api/audio/${detail.meeting.audio_storage_path}`}
            meetingTitle={detail.meeting.title}
          />
        )}
      </div>
    </div>
  );
}
