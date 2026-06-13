// Pure parsing of caption tracks (YouTube json3 + WebVTT) into the
// DiarizedUtterance shape used by the rest of the pipeline. Caption tracks
// carry no speaker information, so every utterance is labelled "CAPTION".
// Any parse failure yields [] (the caller falls back to audio transcription).

import type {
  DiarizedUtterance,
  TranscriptionResult,
} from "@/lib/providers/types";

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Sentinel speaker label for caption (non-diarized) utterances. */
export const CAPTION_SPEAKER_LABEL = "CAPTION";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Parse YouTube's json3 caption format. Returns [] on any failure. */
export function parseJson3(raw: string): CaptionCue[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = (doc as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const cues: CaptionCue[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as {
      tStartMs?: unknown;
      dDurationMs?: unknown;
      segs?: unknown;
    };
    if (typeof e.tStartMs !== "number" || !Array.isArray(e.segs)) continue;
    const text = clean(
      e.segs
        .map((s) =>
          s &&
          typeof s === "object" &&
          typeof (s as { utf8?: unknown }).utf8 === "string"
            ? (s as { utf8: string }).utf8
            : ""
        )
        .join("")
    );
    if (text.length === 0) continue;
    const startMs = e.tStartMs;
    const endMs =
      startMs + (typeof e.dDurationMs === "number" ? e.dDurationMs : 0);
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

const VTT_TIME =
  /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(ms)
  );
}

/** Parse WebVTT. Returns [] on any failure. */
export function parseVtt(raw: string): CaptionCue[] {
  if (!raw || raw.trim().length === 0) return [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cues: CaptionCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(VTT_TIME);
    if (!m) {
      i += 1;
      continue;
    }
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    i += 1;
    const textLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !VTT_TIME.test(lines[i])
    ) {
      textLines.push(lines[i]);
      i += 1;
    }
    const text = clean(textLines.join(" ").replace(/<[^>]+>/g, ""));
    if (text.length > 0) cues.push({ startMs, endMs, text });
  }
  return cues;
}

// Caption tracks arrive as many short, often time-overlapping fragments (a few
// words each). Joined as-is they break the transcript every few words, so we
// coalesce them into readable blocks that end at sentence boundaries.
const COALESCE_MIN_CHARS = 160; // don't end a block before this unless forced
const COALESCE_MAX_CHARS = 360; // hard cap so one block never runs away

function endsSentence(text: string): boolean {
  return /[.!?…]["'”’)\]]?$/.test(text);
}

/** Map caption cues to utterances: drop consecutive exact-duplicate fragments
 *  (rolling auto-captions repeat the visible line), then join the rest into
 *  sentence/paragraph-sized utterances broken at sentence boundaries. */
export function cuesToUtterances(cues: CaptionCue[]): DiarizedUtterance[] {
  // 1) Collapse consecutive exact-duplicate fragments, keeping the widest span.
  const frags: CaptionCue[] = [];
  for (const cue of cues) {
    const prev = frags[frags.length - 1];
    if (prev && prev.text === cue.text) {
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    frags.push({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text });
  }

  // 2) Join fragments into blocks, flushing at a sentence end once the block is
  //    long enough (or at a hard length cap).
  const out: DiarizedUtterance[] = [];
  let start = 0;
  let end = 0;
  let text = "";
  const flush = () => {
    if (text.length === 0) return;
    out.push({
      speaker_label: CAPTION_SPEAKER_LABEL,
      start_ms: start,
      end_ms: end,
      text,
    });
    text = "";
  };
  for (const f of frags) {
    if (text.length === 0) {
      start = f.startMs;
      end = f.endMs;
      text = f.text;
    } else {
      text = `${text} ${f.text}`.replace(/\s+/g, " ").trim();
      end = Math.max(end, f.endMs);
    }
    if (
      text.length >= COALESCE_MAX_CHARS ||
      (endsSentence(text) && text.length >= COALESCE_MIN_CHARS)
    ) {
      flush();
    }
  }
  flush();
  return out;
}

/** Build a TranscriptionResult from cues, or null if there are no usable cues. */
export function captionResultFromCues(
  cues: CaptionCue[],
  language: string
): TranscriptionResult | null {
  const utterances = cuesToUtterances(cues);
  if (utterances.length === 0) return null;
  const last = utterances[utterances.length - 1];
  return {
    rawJson: { source: "captions", language, cues },
    language,
    durationSeconds: Math.round(last.end_ms / 1000),
    utterances,
  };
}
