// OpenGraph / Twitter metadata for the meeting detail page. Pure builder so the
// published-only rule (do NOT leak an unpublished meeting's title/summary into
// social cards) is unit-tested without booting Next.

import { describe, expect, it } from "vitest";
import { buildMeetingMetadata } from "@/lib/meetings/metadata";
import type { Meeting, Summary } from "@/lib/types";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "City Council Regular Meeting",
    body_name: "City Council",
    source_type: "stream",
    kind: "civic",
    source_url: "https://example.test/v",
    status: "complete",
    error_message: null,
    scheduled_at: null,
    audio_storage_path: null,
    duration_seconds: 3600,
    schedule_id: null,
    occurrence_key: null,
    published: true,
    published_at: "2026-06-13T00:00:00.000Z",
    tenant_id: null,
    source_key: null,
    live_enabled: false,
    live_started_at: null,
    live_ended_at: null,
    created_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

function summary(overview: string): Summary {
  return {
    id: "s1",
    meeting_id: "11111111-1111-1111-1111-111111111111",
    overview,
    key_decisions: [],
    action_items: [],
    topics: [],
    full_markdown: "",
  };
}

const BASE = "https://civicscribe.up.railway.app";

describe("buildMeetingMetadata", () => {
  it("returns a not-found title when the meeting is missing", () => {
    const md = buildMeetingMetadata({
      meeting: null,
      summary: null,
      isAdmin: false,
      baseUrl: BASE,
    });
    expect(String(md.title)).toContain("not found");
    // Never advertise a non-existent page.
    expect(md.openGraph).toBeUndefined();
  });

  it("builds OG + Twitter cards for a published meeting", () => {
    const md = buildMeetingMetadata({
      meeting: meeting(),
      summary: summary("Council approved the budget and a new park."),
      isAdmin: false,
      baseUrl: BASE,
    });
    // OpenGraph/Twitter are discriminated unions in Next's types; read the
    // discriminant fields through a record view for the assertions.
    const og = md.openGraph as Record<string, unknown> | undefined;
    const tw = md.twitter as Record<string, unknown> | undefined;
    expect(md.title).toBe("City Council Regular Meeting");
    expect(og?.title).toBe("City Council Regular Meeting");
    expect(og?.description).toContain("approved the budget");
    expect(og?.type).toBe("article");
    expect(og?.url).toBe(
      `${BASE}/meetings/11111111-1111-1111-1111-111111111111`
    );
    expect(tw?.card).toBe("summary_large_image");
    expect(tw?.title).toBe("City Council Regular Meeting");
  });

  it("falls back to a body-name description when there is no summary", () => {
    const md = buildMeetingMetadata({
      meeting: meeting(),
      summary: null,
      isAdmin: false,
      baseUrl: BASE,
    });
    expect(md.openGraph?.description).toContain("City Council");
  });

  it("does NOT leak an unpublished meeting's title or summary to the public", () => {
    const secret = summary("Confidential draft discussion of layoffs.");
    const md = buildMeetingMetadata({
      meeting: meeting({ published: false, title: "Draft executive session" }),
      summary: secret,
      isAdmin: false,
      baseUrl: BASE,
    });
    // No social cards at all for an unpublished page seen by the public.
    expect(md.openGraph).toBeUndefined();
    expect(md.twitter).toBeUndefined();
    // robots: do not index an unpublished page.
    expect(md.robots).toMatchObject({ index: false });
    // The visible title must not reveal the real (draft) title.
    expect(String(md.title)).not.toContain("Draft executive session");
    expect(String(md.title)).not.toContain("layoffs");
  });

  it("shows the real metadata to an admin even when unpublished", () => {
    const md = buildMeetingMetadata({
      meeting: meeting({ published: false }),
      summary: summary("Internal review of the budget."),
      isAdmin: true,
      baseUrl: BASE,
    });
    expect(md.title).toBe("City Council Regular Meeting");
    expect(md.openGraph?.description).toContain("Internal review");
  });

  it("truncates an over-long overview for the social description", () => {
    const long = "A".repeat(500);
    const md = buildMeetingMetadata({
      meeting: meeting(),
      summary: summary(long),
      isAdmin: false,
      baseUrl: BASE,
    });
    const desc = md.openGraph?.description ?? "";
    expect(desc.length).toBeLessThanOrEqual(200);
  });
});
