import { NextResponse } from "next/server";
import { getStore, getFileStorage } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_UPLOAD_MB = 512;

/** Upload size cap in bytes (override with the MAX_UPLOAD_MB env var). */
function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_MB;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const mb =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB;
  return mb * 1024 * 1024;
}

// Extension allowlist mapped to the MIME type we STORE. The client-provided
// file.type is never trusted or persisted — a spoofed Content-Type can't make
// us serve, say, text/html from the audio route.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

/** Allowlisted extension from the original filename (lowercase, with dot). */
function extensionFromFilename(name: string): string | null {
  const match = /(\.[A-Za-z0-9]+)$/.exec(name);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return ext in CONTENT_TYPE_BY_EXTENSION ? ext : null;
}

function tooLargeResponse(limitBytes: number) {
  return NextResponse.json(
    {
      error: `File too large. The upload limit is ${Math.floor(limitBytes / (1024 * 1024))} MB.`,
    },
    { status: 413 }
  );
}

/**
 * POST /api/upload — multipart form with title, body_name, and an audio/video
 * file. Creates an upload-source meeting, stores the file at
 * meetings/<id>/audio<ext>, and enqueues the capture job (which skips straight
 * to transcription for uploads).
 */
export async function POST(request: Request) {
  const limitBytes = maxUploadBytes();

  // Cheap rejection BEFORE reading the body: trust a declared Content-Length
  // only to bail early. The actual read size is re-checked below.
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    return tooLargeResponse(limitBytes);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 }
    );
  }

  const title = form.get("title");
  const bodyName = form.get("body_name");
  const file = form.get("file");
  const kind = form.get("kind") === "course" ? "course" : "civic";

  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (typeof bodyName !== "string" || bodyName.trim() === "") {
    return NextResponse.json({ error: "body_name is required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "file is required and must not be empty" },
      { status: 400 }
    );
  }
  if (file.size > limitBytes) {
    return tooLargeResponse(limitBytes);
  }

  // The stored content type is derived ONLY from the extension allowlist;
  // files without an allowlisted extension are rejected outright.
  const ext = extensionFromFilename(file.name);
  if (!ext) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Upload an audio or video file such as .mp3, .m4a, .wav, or .mp4.",
      },
      { status: 400 }
    );
  }
  const contentType = CONTENT_TYPE_BY_EXTENSION[ext];

  try {
    const store = getStore();
    const files = getFileStorage();

    const meeting = await store.createMeeting({
      title: title.trim(),
      body_name: bodyName.trim(),
      source_type: "upload",
      kind,
    });

    const storagePath = `meetings/${meeting.id}/audio${ext}`;

    const data = Buffer.from(await file.arrayBuffer());
    await files.put(storagePath, data, contentType);

    const updated = await store.updateMeeting(meeting.id, {
      audio_storage_path: storagePath,
    });

    try {
      await store.enqueueJob(meeting.id, "capture");
    } catch (err) {
      // Don't strand a zombie "pending" meeting no job will ever advance.
      await store
        .setMeetingStatus(
          meeting.id,
          "failed",
          "failed to enqueue processing job"
        )
        .catch(() => {});
      const message =
        err instanceof Error ? err.message : "failed to enqueue processing job";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(updated, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
