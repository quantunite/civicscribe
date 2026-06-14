// Pure builder for the meeting detail page's per-meeting metadata
// (title + OpenGraph + Twitter + robots).
//
// Published boundary: the social cards (openGraph/twitter) and an indexable
// page are produced ONLY for a meeting the public may see (published, or any
// meeting when viewed by an admin). For an unpublished page seen by the public
// we must not leak the real title or summary into a card or the visible title,
// and we must mark it noindex. This mirrors the published/admin 404 boundary
// the detail route already enforces; metadata is rendered before that 404, so
// the leak guard lives here too.

import type { Metadata } from "next";
import type { Meeting, Summary } from "@/lib/types";

/** Max length for a social-card description (OG/Twitter render ~160-200 chars). */
const MAX_DESCRIPTION = 200;

export interface BuildMeetingMetadataInput {
  meeting: Meeting | null;
  summary: Summary | null;
  isAdmin: boolean;
  baseUrl: string;
}

/** Collapse whitespace and clip to `max` chars on a word boundary with an ellipsis. */
function clip(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  // Reserve one char for the ellipsis; cut back to the last space if possible.
  const slice = normalized.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${body.trimEnd()}…`;
}

export function buildMeetingMetadata(
  input: BuildMeetingMetadataInput
): Metadata {
  const { meeting, summary, isAdmin, baseUrl } = input;

  if (!meeting) {
    return { title: "Meeting not found" };
  }

  const visibleToPublic = meeting.published || isAdmin;

  // Public viewer of an unpublished page: reveal nothing. Generic title, no
  // cards, noindex. (The page itself will 404 for them; this just makes sure
  // any pre-404 metadata pass cannot leak.)
  if (!visibleToPublic) {
    return {
      title: "Meeting",
      robots: { index: false, follow: false },
    };
  }

  const description = summary?.overview
    ? clip(summary.overview, MAX_DESCRIPTION)
    : clip(
        `Transcript and summary of ${meeting.title} (${meeting.body_name}) on CivicScribe.`,
        MAX_DESCRIPTION
      );

  const url = `${baseUrl.replace(/\/$/, "")}/meetings/${meeting.id}`;

  return {
    title: meeting.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: meeting.title,
      description,
      type: "article",
      url,
      siteName: "CivicScribe",
    },
    twitter: {
      card: "summary_large_image",
      title: meeting.title,
      description,
    },
  };
}
