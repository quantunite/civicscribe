import { getFileStorage } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ByteRange {
  start: number;
  end: number;
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
  const file = await getFileStorage().get(storagePath);
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const { data, contentType } = file;
  const size = data.byteLength;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
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
    const chunk = data.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
