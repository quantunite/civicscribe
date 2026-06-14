"use client";

// Virtualized transcript list. Rows are dynamically measured
// (measureElement) so long utterances take the space they need. Supports
// deep links: when the page loads with #u-<utteranceId>, the list scrolls to
// that utterance and flash-highlights it.

import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Utterance } from "@/lib/types";
import { SpeakerName } from "@/components/meeting/SpeakerName";
import { CopyLinkButton } from "@/components/meeting/CopyLinkButton";
import {
  formatTimestamp,
  HighlightedText,
  speakerColor,
  speakerDisplayName,
} from "@/components/meeting/transcript-utils";

interface TranscriptListProps {
  /** The (possibly filtered) utterances to render, ordered by start_ms. */
  utterances: Utterance[];
  /** Active search tokens, used to highlight matches with <mark>. */
  tokens: string[];
  /** Diarized transcripts show per-speaker labels + audio seek + rename;
   *  caption transcripts (no speakers, no audio) render plain text. */
  diarized: boolean;
  onSeek: (ms: number) => void;
  /** Persists a renamed speaker. Omit to render speaker names read-only
   *  (public/non-admin view). */
  onRename?: (utteranceId: string, name: string) => Promise<void>;
  /** The meeting id, threaded so each utterance can offer a citation deep link. */
  meetingId: string;
  /** Show the per-utterance "copy link" citation control. Citations are only
   *  offered for published meetings (the public detail page 404s unpublished for
   *  non-admins, so a reachable public page is always published). */
  canCite?: boolean;
}

export function TranscriptList({
  utterances,
  tokens,
  diarized,
  onSeek,
  onRename,
  meetingId,
  canCite = false,
}: TranscriptListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const deepLinkedRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: utterances.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    overscan: 10,
    getItemKey: (index) => utterances[index]?.id ?? index,
  });

  // Deep link: #u-<utteranceId> -> scroll to that row and flash it. Runs once
  // on mount (the filter is empty at that point, so indexes match the full
  // transcript).
  useEffect(() => {
    if (deepLinkedRef.current) return;
    deepLinkedRef.current = true;
    const match = window.location.hash.match(/^#u-(.+)$/);
    const targetId = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (!targetId) return;
    const index = utterances.findIndex((u) => u.id === targetId);
    if (index < 0) return;
    // Give the virtualizer a frame to attach to the scroll element, then
    // scroll twice: dynamic measurement refines offsets after the first jump.
    const first = setTimeout(() => {
      virtualizer.scrollToIndex(index, { align: "center" });
      setFlashId(targetId);
    }, 60);
    const second = setTimeout(() => {
      virtualizer.scrollToIndex(index, { align: "center" });
    }, 260);
    const clear = setTimeout(() => setFlashId(null), 2800);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
      clearTimeout(clear);
    };
  }, [utterances, virtualizer]);

  if (utterances.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-lg leading-[1.7] text-slate-600">
        No utterances match your search.
      </p>
    );
  }

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      aria-label="Transcript utterances (scrollable)"
      className="max-h-[65vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
    >
      <div
        role="list"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const utterance = utterances[item.index];
          if (!utterance) return null;
          const flashed = flashId === utterance.id;
          return (
            <article
              key={item.key}
              role="listitem"
              id={`u-${utterance.id}`}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
              className={`border-b border-slate-100 transition-colors duration-700 ${
                flashed ? "bg-teal-50 ring-2 ring-inset ring-teal-500" : ""
              }`}
            >
              {diarized ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                  <button
                    type="button"
                    onClick={() => onSeek(utterance.start_ms)}
                    aria-label={`Play audio from ${formatTimestamp(utterance.start_ms)}`}
                    title="Play audio from here"
                    className="rounded font-mono text-base font-medium tabular-nums text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950 hover:decoration-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                  >
                    {formatTimestamp(utterance.start_ms)}
                  </button>
                  <SpeakerName
                    utteranceId={utterance.id}
                    speakerLabel={utterance.speaker_label}
                    displayName={speakerDisplayName(
                      utterance.speaker_name,
                      utterance.speaker_label
                    )}
                    color={speakerColor(utterance.speaker_label)}
                    onRename={onRename}
                  />
                  {canCite && (
                    <CopyLinkButton
                      meetingId={meetingId}
                      utteranceId={utterance.id}
                      label={`${speakerDisplayName(
                        utterance.speaker_name,
                        utterance.speaker_label
                      )} at ${formatTimestamp(utterance.start_ms)}`}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                  <span className="font-mono text-base font-medium tabular-nums text-slate-500">
                    {formatTimestamp(utterance.start_ms)}
                  </span>
                  {canCite && (
                    <CopyLinkButton
                      meetingId={meetingId}
                      utteranceId={utterance.id}
                      label={`utterance at ${formatTimestamp(
                        utterance.start_ms
                      )}`}
                    />
                  )}
                </div>
              )}
              <p className="px-4 pb-4 pt-1.5 text-lg leading-[1.7] text-slate-900">
                <HighlightedText text={utterance.text} tokens={tokens} />
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
