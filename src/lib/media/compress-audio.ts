// Shrink a meeting recording before it is stored, so long captures fit under
// the storage upload size limit (Supabase's per-object cap) and take less of a
// constrained storage quota.
//
// Meeting audio is speech, so we transcode to MONO AAC at a low bitrate
// (default 32 kbps ≈ 14 MB/hour): inaudible loss for voice, but a ~4-8x size
// reduction. Transcription (AssemblyAI) and diarization are unaffected — they
// bill by duration and analyze a single mixed stream regardless of bitrate.
//
// Best-effort: ANY failure (ffmpeg missing, encode error, empty output) returns
// null so the caller uploads the original bytes. Compression must never be the
// reason a capture fails.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { log } from "@/lib/logger";

const DEFAULT_KBPS = 32;

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", () => {});
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new Error("ffmpeg not found on PATH (set FFMPEG_PATH)")
          : new Error(`failed to start ffmpeg: ${err.message}`)
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with code ${code ?? "unknown"}: ${stderr.trim().slice(-300) || "(no stderr)"}`
          )
        );
    });
  });
}

/**
 * Transcode audio bytes to mono low-bitrate AAC (m4a). Returns the compressed
 * bytes + content type, or null if compression could not be performed (callers
 * fall back to the original audio). The target bitrate can be overridden per
 * call or via the AUDIO_TARGET_KBPS env var.
 */
export async function compressMeetingAudio(
  data: Buffer,
  opts?: { kbps?: number }
): Promise<{ data: Buffer; contentType: string } | null> {
  const envKbps = Number(process.env.AUDIO_TARGET_KBPS);
  const kbps =
    opts?.kbps ??
    (Number.isFinite(envKbps) && envKbps > 0 ? envKbps : DEFAULT_KBPS);
  const binary = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const dir = join(
    tmpdir(),
    `civicscribe-compress-${randomBytes(8).toString("hex")}`
  );
  await mkdir(dir, { recursive: true });
  const input = join(dir, "in");
  const output = join(dir, "out.m4a");

  try {
    await writeFile(input, data);
    await runFfmpeg(binary, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn", // drop any video stream; keep audio only
      "-ac",
      "1", // mono
      "-c:a",
      "aac",
      "-b:a",
      `${kbps}k`,
      "-movflags",
      "+faststart", // metadata at the front so the player can seek immediately
      output,
    ]);
    const out = await readFile(output);
    if (out.length === 0) throw new Error("ffmpeg produced an empty file");
    log.info("compressed meeting audio for storage", {
      fromBytes: data.length,
      toBytes: out.length,
      kbps,
    });
    return { data: out, contentType: "audio/mp4" };
  } catch (err) {
    // Never fail a capture because compression failed — keep the original.
    log.warn("audio compression failed; uploading original audio", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
