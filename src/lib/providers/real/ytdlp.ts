// Real StreamIngestProvider that shells out to yt-dlp.
// Expects "yt-dlp" on PATH (override with the YTDLP_PATH env var). Extracts
// audio as m4a into a per-call temp directory, reads it into a Buffer, and
// cleans up. Windows-safe: uses node:path joins and resolves yt-dlp.exe via
// PATH the same way as on POSIX.
//
// Live-stream note (documented limitation): --no-part writes the download
// directly (no .part file), which behaves better for live/HLS streams that
// can't be resumed. Scheduled capture of not-yet-started live streams is v2;
// this provider handles VODs and already-live streams that yt-dlp can read.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamIngestProvider } from "@/lib/providers/types";

function tail(text: string, max = 600): string {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

function runYtDlp(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    // Drain stdout so the process never blocks on a full pipe.
    child.stdout.on("data", () => {});

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp not found — install it and ensure it is on PATH (see README: going live), " +
              "or point YTDLP_PATH at the executable."
          )
        );
      } else {
        reject(new Error(`Failed to start yt-dlp (${binary}): ${err.message}`));
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `yt-dlp exited with code ${code ?? "unknown"}: ${tail(stderr) || "(no stderr output)"}`
          )
        );
      }
    });
  });
}

export class YtDlpStreamIngestProvider implements StreamIngestProvider {
  async extractAudio(streamUrl: string): Promise<{
    data: Buffer;
    contentType: string;
    durationSeconds: number | null;
  }> {
    const binary = process.env.YTDLP_PATH?.trim() || "yt-dlp";
    const tempDir = join(
      tmpdir(),
      `civicscribe-ytdlp-${randomBytes(8).toString("hex")}`
    );
    await mkdir(tempDir, { recursive: true });

    try {
      const outputTemplate = join(tempDir, "audio.%(ext)s");
      const args = [
        "-x", // extract audio only
        "--audio-format",
        "m4a",
        "--no-part", // write directly — plays nicer with live/HLS streams
        "--no-playlist", // a meeting URL is a single video, never a playlist
        "--no-progress",
        "-o",
        outputTemplate,
        // End-of-options marker: a user-supplied URL can never be parsed as
        // a yt-dlp flag (e.g. "--exec ...").
        "--",
        streamUrl,
      ];

      await runYtDlp(binary, args);

      const files = await readdir(tempDir);
      const produced = files.find((f) => f.startsWith("audio."));
      if (!produced) {
        throw new Error(
          `yt-dlp completed but produced no audio file (temp dir contained: ${files.join(", ") || "nothing"}).`
        );
      }

      const data = await readFile(join(tempDir, produced));
      return {
        data,
        contentType: "audio/mp4", // m4a container
        // Duration is filled in later by the transcription provider
        // (AssemblyAI reports audio_duration).
        durationSeconds: null,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup; a leaked temp dir must never fail the job.
      });
    }
  }
}
