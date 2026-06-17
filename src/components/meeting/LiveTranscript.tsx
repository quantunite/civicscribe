"use client";

// Live transcript viewer (polling, not Supabase Realtime).
//
// Seeds from the server-rendered initial lines, then polls
// GET /api/meetings/{id}/live?since={cursor} every 2s, appending new finalized
// utterances and advancing the cursor. Auto-scrolls to the newest line. It keeps
// polling while waiting for the bot to join AND while live, and stops only when
// the meeting is over (phase "ended"); once published it links to the permanent
// record. ?popout=1 renders minimal chrome so the window can sit beside a meeting.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { LiveUtterance } from "@/lib/types";

const POLL_MS = 2000;

export type LivePhase = "waiting" | "live" | "ended";

/** The rolling "here's what you missed" recap, shared across all viewers. */
interface CatchUp {
  text: string;
  updatedAt: string | null;
}

interface LiveTranscriptProps {
  meetingId: string;
  initial: LiveUtterance[];
  initialPhase: LivePhase;
  title: string;
  bodyName: string;
  initialCatchUp: CatchUp | null;
  popout?: boolean;
}

function maxId(rows: LiveUtterance[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0);
}

interface LivePollResponse {
  utterances: LiveUtterance[];
  phase: LivePhase;
  live: boolean;
  status: string;
  published: boolean;
  cursor: number;
  catchUp: CatchUp | null;
}

/** A compact "updated X ago" label from an ISO timestamp. Returns "" when the
 *  timestamp is missing or unparseable so the caller can omit the line. */
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export function LiveTranscript({
  meetingId,
  initial,
  initialPhase,
  title,
  bodyName,
  initialCatchUp,
  popout = false,
}: LiveTranscriptProps) {
  const [rows, setRows] = useState<LiveUtterance[]>(initial);
  const [phase, setPhase] = useState<LivePhase>(initialPhase);
  const [published, setPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(initialCatchUp);

  // Cursor lives in a ref so the poll closure always reads the latest value
  // without re-subscribing the interval on every new line.
  const cursorRef = useRef<number>(maxId(initial));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to the newest line on every append. v1 always scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/meetings/${meetingId}/live?since=${cursorRef.current}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as LivePollResponse;
          if (cancelled) return;
          if (data.utterances.length > 0) {
            setRows((prev) => [...prev, ...data.utterances]);
            cursorRef.current = data.cursor;
          }
          setPhase(data.phase);
          setPublished(data.published);
          setCatchUp(data.catchUp);
          // Keep polling while waiting for the bot to join AND while live; stop
          // only once the meeting is genuinely over.
          if (data.phase === "ended") return;
        }
      } catch {
        // Transient network error: keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [meetingId]);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy failures; the URL is in the address bar regardless.
    }
  }, []);

  function openPopout() {
    window.open(
      `/meetings/${meetingId}/live?popout=1`,
      "_blank",
      "width=420,height=720"
    );
  }

  const transcript = (
    <div
      ref={scrollRef}
      tabIndex={0}
      aria-label="Live transcript (scrollable)"
      aria-live="polite"
      className={`overflow-y-auto rounded-xl border border-line bg-surface shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ${
        popout ? "max-h-[calc(100vh-3rem)]" : "max-h-[70vh]"
      }`}
    >
      {rows.length === 0 ? (
        <p className="p-6 text-ink-soft">
          {phase === "ended"
            ? "No live transcript was captured for this meeting."
            : "Waiting for the meeting to start. Lines appear here as people speak."}
        </p>
      ) : (
        <ul role="list" className="divide-y divide-line">
          {rows.map((u) => (
            <li key={u.id} className="px-4 py-3 leading-[1.7] text-ink">
              {u.speaker_label && (
                <span className="mr-2 font-semibold text-ink">
                  {u.speaker_label}
                </span>
              )}
              <span>{u.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // "Here's what you missed": the rolling recap, shared across all viewers and
  // shown above the transcript. Hidden in popout mode (kept minimal) and when no
  // recap exists yet. The recap is auto-generated from the unreviewed live
  // transcript, so it is labeled as such.
  const catchUpCard = !popout && catchUp?.text && (
    <section
      aria-label="Here's what you missed"
      className="mb-4 rounded-xl border border-line bg-primary-soft p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
        Here&apos;s what you missed
      </h2>
      <p className="mt-2 whitespace-pre-line leading-[1.7] text-ink">
        {catchUp.text}
      </p>
      <p className="mt-3 text-xs text-ink-soft">
        AI-generated recap of the live transcript. It may contain errors and is
        not an official record.
        {relativeTime(catchUp.updatedAt) !== "" && (
          <> Updated {relativeTime(catchUp.updatedAt)}.</>
        )}
      </p>
    </section>
  );

  const endedNote = phase === "ended" && (
    <p
      role="status"
      className="mt-4 rounded-md border border-line bg-primary-soft px-4 py-3 text-sm text-ink-soft"
    >
      {published ? (
        <>
          This meeting has ended. The reviewed record is now available.{" "}
          <Link
            href={`/meetings/${meetingId}`}
            className="font-semibold text-accent-strong underline"
          >
            Open the published meeting
          </Link>
          .
        </>
      ) : (
        "This meeting has ended. A reviewed transcript and summary will be published soon."
      )}
    </p>
  );

  // Popout: minimal chrome, just the transcript with small padding.
  if (popout) {
    return (
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <LiveDot phase={phase} />
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
        </div>
        {transcript}
        {endedNote}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <LiveDot phase={phase} />
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {phase === "live"
              ? "Live now"
              : phase === "waiting"
                ? "Waiting to start"
                : "Ended"}
          </p>
        </div>
        <h1 className="mt-2 text-3xl">{title}</h1>
        <p className="mt-1 text-ink-soft">{bodyName}</p>
        <p className="mt-3 max-w-2xl text-sm text-ink-soft">
          A live transcript anyone can follow while the meeting happens. The
          reviewed transcript and summary are published after it ends.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={openPopout}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 font-semibold text-ink hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
          >
            Pop out
          </button>
        </div>
      </header>
      {catchUpCard}
      {transcript}
      {endedNote}
    </div>
  );
}

function LiveDot({ phase }: { phase: LivePhase }) {
  const tone =
    phase === "live"
      ? "animate-pulse bg-red-600"
      : phase === "waiting"
        ? "animate-pulse bg-amber-500"
        : "bg-ink-soft";
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`}
    />
  );
}
