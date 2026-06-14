// Real TranscriptionProvider backed by AssemblyAI.
// One call gives transcription + speaker diarization (speaker_labels: true).
// Auth header is lowercase "authorization: <key>" per AssemblyAI docs.

import type { AppConfig } from "@/lib/config";
import type {
  AudioSource,
  DiarizedUtterance,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/lib/providers/types";
import { log } from "@/lib/logger";
import { estimateAssemblyAiUsd } from "@/lib/spend";

const API_BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 3_000;
/** Give up after ~30 minutes of polling. */
const MAX_POLL_MS = 30 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Minimal shapes of the AssemblyAI responses we read.

interface AssemblyAiUploadResponse {
  upload_url?: string;
}

interface AssemblyAiUtterance {
  speaker?: string | null;
  start?: number | null;
  end?: number | null;
  text?: string | null;
}

interface AssemblyAiTranscript {
  id?: string;
  status?: "queued" | "processing" | "completed" | "error" | string;
  error?: string | null;
  language_code?: string | null;
  /** Seconds. */
  audio_duration?: number | null;
  utterances?: AssemblyAiUtterance[] | null;
}

function snippet(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AssemblyAiTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly config: AppConfig) {}

  private requireKey(): string {
    const key = this.config.assemblyAiApiKey;
    if (!key) {
      throw new Error(
        "ASSEMBLYAI_API_KEY is not set: add your AssemblyAI API key to the environment " +
          "(see README: going live) or run with MOCK_MODE=true."
      );
    }
    return key;
  }

  /** Upload raw audio bytes; returns a URL AssemblyAI can transcribe from. */
  private async upload(data: Buffer): Promise<string> {
    const key = this.requireKey();
    // View over the Buffer's memory (no copy of the potentially large audio).
    // The assertion is safe: Node Buffers from file reads/HTTP downloads are
    // always backed by a plain (non-shared) ArrayBuffer, but Buffer's TS type
    // says ArrayBufferLike, which fetch's BodyInit rejects.
    const body = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength
    ) as Uint8Array<ArrayBuffer>;

    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: {
        authorization: key,
        "content-type": "application/octet-stream",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `AssemblyAI POST /v2/upload failed with HTTP ${res.status}: ${snippet(text) || "(empty body)"}`
      );
    }
    const json = (await res.json()) as AssemblyAiUploadResponse;
    if (!json.upload_url) {
      throw new Error(
        `AssemblyAI POST /v2/upload succeeded but returned no upload_url: ${snippet(JSON.stringify(json))}`
      );
    }
    return json.upload_url;
  }

  private async createTranscript(audioUrl: string): Promise<string> {
    const key = this.requireKey();
    const res = await fetch(`${API_BASE}/transcript`, {
      method: "POST",
      headers: {
        authorization: key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        speaker_labels: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `AssemblyAI POST /v2/transcript failed with HTTP ${res.status}: ${snippet(text) || "(empty body)"}`
      );
    }
    const json = (await res.json()) as AssemblyAiTranscript;
    if (!json.id) {
      throw new Error(
        `AssemblyAI POST /v2/transcript succeeded but returned no id: ${snippet(JSON.stringify(json))}`
      );
    }
    return json.id;
  }

  private async getTranscript(id: string): Promise<AssemblyAiTranscript> {
    const key = this.requireKey();
    const res = await fetch(`${API_BASE}/transcript/${id}`, {
      headers: { authorization: key },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `AssemblyAI GET /v2/transcript/${id} failed with HTTP ${res.status}: ${snippet(text) || "(empty body)"}`
      );
    }
    return (await res.json()) as AssemblyAiTranscript;
  }

  async transcribe(audio: AudioSource): Promise<TranscriptionResult> {
    // Touch the key up front so a missing key fails fast with a clear message
    // before any upload work happens.
    this.requireKey();

    const audioUrl =
      audio.kind === "bytes" ? await this.upload(audio.data) : audio.url;

    const transcriptId = await this.createTranscript(audioUrl);

    const deadline = Date.now() + MAX_POLL_MS;
    for (;;) {
      const transcript = await this.getTranscript(transcriptId);

      if (transcript.status === "completed") {
        const utterances: DiarizedUtterance[] = (
          transcript.utterances ?? []
        ).map((u) => ({
          speaker_label: String(u.speaker ?? "Unknown"),
          start_ms: typeof u.start === "number" ? u.start : 0,
          end_ms: typeof u.end === "number" ? u.end : 0,
          text: u.text ?? "",
        }));

        // Per-job spend logging (observability only): estimated USD for the
        // audio hours transcribed. Logged on completion so the global daily
        // spend is observable once real keys are on.
        const durationSeconds =
          typeof transcript.audio_duration === "number"
            ? transcript.audio_duration
            : null;
        log.info("assemblyai: transcription spend", {
          transcriptId,
          durationSeconds,
          estimatedUsd: Number(
            estimateAssemblyAiUsd(durationSeconds).toFixed(4)
          ),
        });

        return {
          rawJson: transcript,
          language: transcript.language_code ?? "en",
          durationSeconds:
            typeof transcript.audio_duration === "number"
              ? transcript.audio_duration
              : null,
          utterances,
        };
      }

      if (transcript.status === "error") {
        throw new Error(
          `AssemblyAI transcription ${transcriptId} failed: ${transcript.error ?? "(no error detail returned)"}`
        );
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `AssemblyAI transcription ${transcriptId} did not complete within ${Math.round(
            MAX_POLL_MS / 60_000
          )} minutes (last status: "${transcript.status ?? "unknown"}").`
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }
}
