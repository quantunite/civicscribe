import { NextResponse } from "next/server";
import { getStore, getFileStorage } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".webm",
  ".ogg",
  ".opus",
  ".aac",
  ".flac",
  ".mov",
  ".mkv",
]);

/** Extension from the original filename (lowercase, including the dot). */
function extensionFromFilename(name: string): string | null {
  const match = /(\.[A-Za-z0-9]+)$/.exec(name);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

function isAcceptableUpload(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return true;
  }
  return extensionFromFilename(file.name) !== null;
}

/** Fallback extension when the filename has none we recognize. */
function extensionFromMime(type: string): string {
  if (type.includes("mpeg") || type.includes("mp3")) return ".mp3";
  if (type.includes("mp4")) return ".mp4";
  if (type.includes("wav")) return ".wav";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("webm")) return ".webm";
  if (type.includes("aac")) return ".aac";
  if (type.includes("flac")) return ".flac";
  return ".bin";
}

/**
 * POST /api/upload — multipart form with title, body_name, and an audio/video
 * file. Creates an upload-source meeting, stores the file at
 * meetings/<id>/audio<ext>, and enqueues the capture job (which skips straight
 * to transcription for uploads).
 */
export async function POST(request: Request) {
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
  if (!isAcceptableUpload(file)) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Upload an audio or video file such as .mp3, .m4a, .wav, or .mp4.",
      },
      { status: 400 }
    );
  }

  try {
    const store = getStore();
    const files = getFileStorage();

    const meeting = await store.createMeeting({
      title: title.trim(),
      body_name: bodyName.trim(),
      source_type: "upload",
    });

    const ext =
      extensionFromFilename(file.name) ?? extensionFromMime(file.type);
    const storagePath = `meetings/${meeting.id}/audio${ext}`;

    const data = Buffer.from(await file.arrayBuffer());
    await files.put(storagePath, data, file.type || "application/octet-stream");

    const updated = await store.updateMeeting(meeting.id, {
      audio_storage_path: storagePath,
    });
    await store.enqueueJob(meeting.id, "capture");

    return NextResponse.json(updated, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
