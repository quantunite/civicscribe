import { getFileStorage, getStore } from "@/lib/store";
import { isStaffRequest } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Audio is stored at a deterministic path: meetings/<meetingId>/audio<ext>.
 * Pull the owning meeting id out of the storage path so the route can enforce
 * the same published/admin boundary the detail + export routes apply. Returns
 * null for any path that is not the expected meetings/<id>/... shape.
 */
function meetingIdFromStoragePath(storagePath: string): string | null {
  const match = /^meetings\/([^/]+)\//.exec(storagePath);
  return match ? match[1] : null;
}

/**
 * Parse an HTTP Range header against a resource of `size` bytes.
 * Supports "bytes=start-end", "bytes=start-" and the suffix form "bytes=-n".
 * Returns null when the header is malformed or unsatisfiable.
 */
function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    // Suffix range: last N bytes.
    const suffixLength = Number.parseInt(endRaw, 10);
    if (Number.isNaN(suffixLength) || suffixLength === 0) return null;
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number.parseInt(startRaw, 10);
  if (Number.isNaN(start) || start >= size) return null;
  const end =
    endRaw === "" ? size - 1 : Math.min(Number.parseInt(endRaw, 10), size - 1);
  if (Number.isNaN(end) || end < start) return null;
  return { start, end };
}

/**
 * GET /api/audio/<storage path> — streams stored meeting audio to the browser.
 * Serves full responses and 206 partial responses so <audio> seeking works
 * against both the local-disk and Supabase storage backends.
 *
 * Published boundary: the raw audio is the most sensitive artifact, so it is
 * gated exactly like the detail page (page.tsx) and OG metadata: an unpublished
 * (pending-review) meeting's audio returns 404 to anyone who is not the admin,
 * resolved from the meeting id embedded in the storage path. Published audio is
 * cached aggressively; admin-viewed unpublished audio is marked private/no-store
 * so a shared/CDN cache never persists pending audio.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];

  // Reject empty or traversal-shaped paths before touching storage.
  if (
    segments.length === 0 ||
    segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\\"))
  ) {
    return new Response("Not found", { status: 404 });
  }

  const storagePath = segments.join("/");

  // Published boundary BEFORE storage I/O: resolve the owning meeting and 404
  // for the public when it is not published. Mirrors page.tsx:118. When
  // OWNER_SECRET is unset, isAdminRequest is true for everyone (dev/MOCK_MODE),
  // so this is a no-op there. A path that does not resolve to a known,
  // visible meeting is a 404 (and is never written to a shared cache).
  const meetingId = meetingIdFromStoragePath(storagePath);
  const meeting = meetingId ? await getStore().getMeeting(meetingId) : null;
  const isAdmin = await isStaffRequest(request);
  const visible = !!meeting && (meeting.published || isAdmin);
  if (!visible) {
    return new Response("Not found", { status: 404 });
  }

  const storage = getFileStorage();
  const meta = await storage.stat(storagePath);
  if (!meta) {
    return new Response("Not found", { status: 404 });
  }

  const { size, contentType } = meta;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    // Audio paths embed the immutable meeting id (meetings/<id>/audio<ext>) and
    // the bytes never change once stored. Cache aggressively ONLY for published
    // audio; an admin viewing pending audio must never be persisted to a
    // shared/CDN/browser cache (it could outlive an unpublish/delete).
    "Cache-Control": meeting.published
      ? "public, max-age=86400, immutable"
      : "private, no-store",
    // Never let the browser MIME-sniff stored bytes into something
    // executable (e.g. a spoofed upload rendered as HTML).
    "X-Content-Type-Options": "nosniff",
  };

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${size}`,
        },
      });
    }
    // Stream only the requested window — the storage layer never buffers the
    // whole object in memory.
    const stream = await storage.getRange(storagePath, range);
    if (!stream) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }

  const stream = await storage.getRange(storagePath);
  if (!stream) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(stream, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
