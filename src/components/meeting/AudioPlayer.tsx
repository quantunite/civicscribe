"use client";

// Audio player pinned to the bottom of the meeting view. Exposes an
// imperative seek(ms) handle so transcript timestamp clicks can jump the
// playhead; seeking also starts playback.

import { forwardRef, useImperativeHandle, useRef } from "react";

export interface AudioPlayerHandle {
  /** Jump the playhead to the given offset (milliseconds) and play. */
  seek(ms: number): void;
}

interface AudioPlayerProps {
  /** Browser-facing audio URL, e.g. /api/audio/meetings/<id>/audio.wav */
  src: string;
  meetingTitle: string;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, meetingTitle }, ref) {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        seek(ms: number) {
          const el = audioRef.current;
          if (!el) return;
          el.currentTime = Math.max(0, ms / 1000);
          void el.play().catch(() => {
            // Autoplay can be blocked before any user gesture on the element;
            // the playhead is still moved, so a manual press of Play resumes
            // from the right spot.
          });
        },
      }),
      []
    );

    return (
      <div className="border-t border-slate-200 bg-white/85 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur">
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={src}
          aria-label={`Audio recording of ${meetingTitle}`}
          className="w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }
);
