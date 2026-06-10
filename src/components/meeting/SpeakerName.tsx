"use client";

// Inline-editable speaker name chip. The name is a button; clicking it swaps
// in a text input. Enter saves (via onRename, which PATCHes the utterance),
// Escape or blur cancels.

import { useEffect, useRef, useState } from "react";
import type { SpeakerColor } from "@/components/meeting/transcript-utils";

interface SpeakerNameProps {
  utteranceId: string;
  speakerLabel: string;
  /** Resolved display name: speaker_name ?? `Speaker ${label}`. */
  displayName: string;
  color: SpeakerColor;
  /** Persists the new name. Throws on failure. */
  onRename: (utteranceId: string, name: string) => Promise<void>;
}

export function SpeakerName({
  utteranceId,
  speakerLabel,
  displayName,
  color,
  onRename,
}: SpeakerNameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reflect external updates (e.g. "apply to all") while not editing.
  useEffect(() => {
    if (!editing) setValue(displayName);
  }, [displayName, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function cancel() {
    setEditing(false);
    setValue(displayName);
    setError(null);
  }

  async function save() {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === displayName) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(utteranceId, trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the name");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setValue(displayName);
            setEditing(true);
          }}
          aria-label={`Edit name for speaker ${speakerLabel} (currently ${displayName})`}
          title="Edit speaker name"
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-base font-semibold ${color.chip} hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2`}
        >
          {displayName}
          <span aria-hidden="true" className="text-sm opacity-60">
            ✎
          </span>
        </button>
        {error && (
          <span role="alert" className="text-sm font-medium text-red-700">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (!saving) cancel();
        }}
        aria-label={`New name for speaker ${speakerLabel}. Press Enter to save, Escape to cancel.`}
        className="w-44 rounded-md border border-slate-400 bg-white px-2 py-0.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60"
      />
      {saving && (
        <span role="status" className="text-sm text-slate-600">
          Saving…
        </span>
      )}
      {error && (
        <span role="alert" className="text-sm font-medium text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
