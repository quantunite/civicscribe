// Normalize a source_url into a stable dedup key.
//
// Two URLs that point at the same underlying video must produce the same key so
// the library does not accumulate duplicates: on submit we look the key up
// (DataStore.findBySourceKey) and surface the existing item instead of
// re-generating (which spends real money). We:
//  - extract a youtube/vimeo video id where possible ("youtube:<id>" /
//    "vimeo:<id>") so the many youtube URL shapes collapse to one key,
//  - otherwise canonicalize the URL: lowercase scheme + host, drop the default
//    port, drop a trailing slash, strip tracking params (utm_*, fbclid, ...),
//    sort the remaining query params, and drop the fragment.
// Returns null for empty/unparseable/non-http(s) input (those rows just carry a
// null source_key and never dedup, which is the safe default).

import { parseHttpUrl } from "@/lib/net/url";

/** Query params that never identify the content and so must not split dupes. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_reader",
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "feature",
  "si", // youtube share tracking
  "pp", // youtube share tracking
  // playlist context: same video, different surrounding list -> same content.
  "list",
  "index",
  "start_radio",
  // timestamp deep-links: same video, different jump-to point.
  "t",
  "time_continue",
  "start",
]);

function isYoutubeHost(host: string): boolean {
  return (
    host === "youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com") ||
    host.endsWith(".youtu.be")
  );
}

function isVimeoHost(host: string): boolean {
  return host === "vimeo.com" || host.endsWith(".vimeo.com");
}

/** Pull the 11-char youtube video id out of any of its URL shapes. */
function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  // youtu.be/<id>
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isYoutubeId(id) ? id : null;
  }
  // youtube.com/watch?v=<id>
  const v = url.searchParams.get("v");
  if (isYoutubeId(v)) return v;
  // youtube.com/{shorts,embed,v,live}/<id>
  const segs = url.pathname.split("/").filter(Boolean);
  if (
    segs.length >= 2 &&
    ["shorts", "embed", "v", "live"].includes(segs[0])
  ) {
    return isYoutubeId(segs[1]) ? segs[1] : null;
  }
  return null;
}

function isYoutubeId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** Pull the numeric vimeo id out of vimeo.com/<id> or player.vimeo.com/video/<id>. */
function vimeoId(url: URL): string | null {
  const segs = url.pathname.split("/").filter(Boolean);
  for (let i = 0; i < segs.length; i += 1) {
    if (/^\d+$/.test(segs[i])) {
      // player.vimeo.com/video/<id>: the id follows "video".
      if (segs[i - 1] === "video" || i === 0) return segs[i];
    }
  }
  // Plain vimeo.com/<id>.
  if (segs.length === 1 && /^\d+$/.test(segs[0])) return segs[0];
  return null;
}

export function sourceKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const url = parseHttpUrl(trimmed);
  if (!url) return null;

  const host = url.hostname.toLowerCase();

  if (isYoutubeHost(host)) {
    const id = youtubeId(url);
    if (id) return `youtube:${id}`;
  }
  if (isVimeoHost(host)) {
    const id = vimeoId(url);
    if (id) return `vimeo:${id}`;
  }

  // Generic canonicalization. URL already lowercases scheme + host and drops a
  // default port; we additionally strip tracking params, sort what remains,
  // drop the fragment, and trim a trailing slash off the path.
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query =
    params.length > 0
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";

  let pathname = url.pathname.toLowerCase();
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  return `${url.protocol}//${host}${pathname}${query}`;
}
