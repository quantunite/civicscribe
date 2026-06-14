"use client";

// Copy a stable, shareable deep link to a specific transcript utterance:
//   <origin>/meetings/<meetingId>#u-<utteranceId>
//
// The anchor matches the id TranscriptList renders + scrolls/flashes to, so the
// pasted link lands on (and highlights) the exact line. The origin is read from
// the live location at click time so the copied link is correct on whatever
// host the app is actually served from; citationUrl handles the path + encoding.

import { useCallback, useEffect, useRef, useState } from "react";

import { citationUrl } from "@/lib/citations";

interface CopyLinkButtonProps {
  meetingId: string;
  utteranceId: string;
  /** Accessible label, e.g. the speaker + timestamp the link points at. */
  label?: string;
  className?: string;
}

export function CopyLinkButton({
  meetingId,
  utteranceId,
  label,
  className,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = citationUrl(origin, meetingId, utteranceId);
    setFailed(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for browsers without the async clipboard API.
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
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }, [meetingId, utteranceId]);

  const aria = label
    ? `Copy a link to this point (${label})`
    : "Copy a link to this point";

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={aria}
      title="Copy link to this point"
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-semibold text-teal-800 hover:bg-teal-50 hover:text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span aria-live="polite">
        {copied ? "Link copied" : failed ? "Copy failed" : "Copy link"}
      </span>
    </button>
  );
}
