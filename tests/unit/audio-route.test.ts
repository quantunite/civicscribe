// GET /api/audio/[...path] published boundary (src/app/api/audio/[...path]/route.ts).
//
// The raw audio is the most sensitive artifact, so the route must enforce the
// same not-published + not-admin -> 404 boundary the detail page applies, and
// must not let a shared cache persist unpublished audio. These tests stub the
// store + file storage so no real backend is needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Meeting } from "@/lib/types";

const MEETING_ID = "11111111-1111-1111-1111-111111111111";
const AUDIO_PATH = `meetings/${MEETING_ID}/audio.mp3`;

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    title: "City Council Regular Meeting",
    body_name: "City Council",
    source_type: "upload",
    kind: "civic",
    source_url: null,
    status: "complete",
    error_message: null,
    scheduled_at: null,
    audio_storage_path: AUDIO_PATH,
    duration_seconds: 3600,
    schedule_id: null,
    occurrence_key: null,
    published: true,
    published_at: "2026-06-13T00:00:00.000Z",
    tenant_id: null,
    source_key: null,
    created_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

/** Build a request, optionally carrying the admin Bearer credential. */
function req(opts: { admin?: boolean; range?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.admin) headers.authorization = "Bearer s3cret";
  if (opts.range) headers.range = opts.range;
  return new Request(`https://example.test/api/audio/${AUDIO_PATH}`, {
    headers,
  });
}

function params(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

/** Stub getStore().getMeeting and getFileStorage() so the route hits no backend. */
async function stub(opts: {
  meeting: Meeting | null;
  statSize?: number | null;
}): Promise<{ getMeeting: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn> }> {
  const store = await import("@/lib/store");
  const getMeeting = vi.fn().mockResolvedValue(opts.meeting);
  const size = opts.statSize === undefined ? 1024 : opts.statSize;
  const stat = vi
    .fn()
    .mockResolvedValue(size === null ? null : { size, contentType: "audio/mpeg" });
  vi.spyOn(store, "getStore").mockReturnValue({ getMeeting } as never);
  vi.spyOn(store, "getFileStorage").mockReturnValue({
    stat,
    getRange: vi.fn().mockResolvedValue(new ReadableStream()),
  } as never);
  return { getMeeting, stat };
}

describe("GET /api/audio/[...path] — published boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    // Gate enabled: admin must present the secret; the public does not.
    process.env.OWNER_SECRET = "s3cret";
  });

  afterEach(() => {
    delete process.env.OWNER_SECRET;
    vi.restoreAllMocks();
  });

  it("serves published audio to the public with an aggressive cache", async () => {
    await stub({ meeting: meeting({ published: true }) });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req(), params(AUDIO_PATH.split("/")));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=86400, immutable"
    );
  });

  it("404s an unpublished meeting's audio for the public BEFORE touching storage", async () => {
    const { stat } = await stub({ meeting: meeting({ published: false }) });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req(), params(AUDIO_PATH.split("/")));
    expect(res.status).toBe(404);
    // The published boundary must short-circuit before any storage I/O.
    expect(stat).not.toHaveBeenCalled();
  });

  it("serves unpublished audio to an admin but marks it private/no-store", async () => {
    await stub({ meeting: meeting({ published: false }) });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req({ admin: true }), params(AUDIO_PATH.split("/")));
    expect(res.status).toBe(200);
    // Admin-viewed pending audio must never be written to a shared/CDN cache.
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("404s a path that does not resolve to a known meeting", async () => {
    const { stat } = await stub({ meeting: null });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req(), params(AUDIO_PATH.split("/")));
    expect(res.status).toBe(404);
    expect(stat).not.toHaveBeenCalled();
  });

  it("404s a non-meetings path shape without trusting it", async () => {
    const { getMeeting } = await stub({ meeting: meeting() });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req(), params(["secrets", "data.bin"]));
    expect(res.status).toBe(404);
    // No meeting id could be parsed, so the store is never consulted.
    expect(getMeeting).not.toHaveBeenCalled();
  });

  it("is a no-op gate when OWNER_SECRET is unset (dev/MOCK_MODE): published flag still respected", async () => {
    delete process.env.OWNER_SECRET;
    // Open mode: everyone is admin, so even an unpublished meeting is served.
    await stub({ meeting: meeting({ published: false }) });
    const { GET } = await import("@/app/api/audio/[...path]/route");
    const res = await GET(req(), params(AUDIO_PATH.split("/")));
    expect(res.status).toBe(200);
  });
});
