// Real StreamIngestProvider that shells out to yt-dlp.
// Expects "yt-dlp" on PATH (override with the YTDLP_PATH env var).
//  - fetchCaptions: fetch an existing subtitle/caption track (json3 or vtt)
//    without downloading media. Best-effort: returns null on ANY failure
//    (no track, yt-dlp missing, timeout) so the caller falls back to audio.
//  - extractAudio: extract audio as m4a into a per-call temp directory, read
//    it into a Buffer, and clean up.
// Windows-safe: uses node:path joins and resolves yt-dlp.exe via PATH the same
// way as on POSIX.
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

import type { AppConfig } from "@/lib/config";
import {
  captionResultFromCues,
  parseJson3,
  parseVtt,
} from "@/lib/captions/parse";
import type {
  StreamIngestProvider,
  TranscriptionResult,
} from "@/lib/providers/types";

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
            "yt-dlp not found: install it and ensure it is on PATH (see README: going live), " +
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

/** Like runYtDlp but kills the child after timeoutMs. Used for caption fetches,
 *  which must never hang the capture stage. */
function runYtDlpWithTimeout(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp caption fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(`yt-dlp exited with code ${code ?? "unknown"}: ${tail(stderr)}`)
        );
    });
  });
}

export class YtDlpStreamIngestProvider implements StreamIngestProvider {
  constructor(private readonly config: AppConfig) {}

  async fetchCaptions(streamUrl: string): Promise<TranscriptionResult | null> {
    if (!this.config.captionFastLane) return null;

    const binary = process.env.YTDLP_PATH?.trim() || "yt-dlp";
    const tempDir = join(
      tmpdir(),
      `civicscribe-subs-${randomBytes(8).toString("hex")}`
    );
    await mkdir(tempDir, { recursive: true });

    try {
      const args = [
        "--skip-download",
        "--no-playlist",
        "--no-progress",
        "--write-subs", // manual/uploaded subtitles (preferred)
        "--write-auto-subs", // fall back to ASR auto-captions
        "--sub-langs",
        this.config.captionLangs.join(","),
        "--sub-format",
        "json3/vtt/best",
        "-o",
        join(tempDir, "cap.%(ext)s"),
        "--", // a user-supplied URL can never be parsed as a flag
        streamUrl,
      ];

      await runYtDlpWithTimeout(
        binary,
        args,
        this.config.captionFetchTimeoutMs
      );

      const files = await readdir(tempDir);
      // Prefer json3 (carries reliable timing) over vtt.
      const chosen =
        files.find((f) => f.endsWith(".json3")) ??
        files.find((f) => f.endsWith(".vtt"));
      if (!chosen) return null; // no caption track available

      const raw = await readFile(join(tempDir, chosen), "utf8");
      const cues = chosen.endsWith(".json3")
        ? parseJson3(raw)
        : parseVtt(raw);
      return captionResultFromCues(cues, this.config.captionLangs[0] ?? "en");
    } catch {
      // No track, yt-dlp missing, timeout, or any other failure -> fall back.
      return null;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup; a leaked temp dir must never fail the job.
      });
    }
  }

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
