// Citation deep links (Phase 2).
//
// A citation points at ONE utterance on a meeting detail page:
//   /meetings/<meetingId>#u-<utteranceId>
//
// The "#u-<id>" anchor is the same id TranscriptList renders on every utterance
// article and the same fragment it scrolls to and flash-highlights on load, so
// a copied citation always lands on (and lights up) the exact line. Ids are
// percent-encoded so a stray space or '#' in an id never breaks the fragment.
//
// citationPath is relative (in-app navigation); citationUrl prefixes the
// configured base origin so the copied link is shareable off-site. Both are
// pure so the deep-link contract is unit-tested without a browser.

/** The URL fragment for an utterance: "#u-<encoded id>". Matches the id the
 *  transcript list renders and the hash the detail page deep-links to. */
export function utteranceAnchor(utteranceId: string): string {
  return `#u-${encodeURIComponent(utteranceId)}`;
}

/** Relative path to a specific utterance on a meeting page (for in-app links). */
export function citationPath(meetingId: string, utteranceId: string): string {
  return `/meetings/${encodeURIComponent(meetingId)}${utteranceAnchor(
    utteranceId
  )}`;
}

/** Absolute, shareable citation link. `baseUrl` is the site origin (config
 *  baseUrl); a trailing slash on it is collapsed so the path is not doubled. An
 *  empty/unknown base falls back to the relative path (still usable in-app). */
export function citationUrl(
  baseUrl: string,
  meetingId: string,
  utteranceId: string
): string {
  const path = citationPath(meetingId, utteranceId);
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}
