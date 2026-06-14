// Real CaptureProvider backed by the Recall.ai REST API.
// Docs: https://docs.recall.ai — bots are created against the regional host
// https://{region}.recall.ai/api/v1/bot/ and authenticated with
// "Authorization: Token <key>".

import type { AppConfig } from "@/lib/config";
import type { BotStatus, CaptureProvider } from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Minimal shapes of the Recall.ai responses we read. All fields are optional —
// we only narrow what we actually consume and keep the rest opaque.

interface RecallStatusChange {
  code?: string;
  sub_code?: string | null;
  message?: string | null;
  created_at?: string;
}

interface RecallMediaShortcut {
  data?: { download_url?: string | null } | null;
}

interface RecallRecording {
  id?: string;
  media_shortcuts?: {
    audio_mixed?: RecallMediaShortcut | null;
    video_mixed?: RecallMediaShortcut | null;
  } | null;
}

interface RecallBot {
  id?: string;
  status_changes?: RecallStatusChange[] | null;
  recordings?: RecallRecording[] | null;
  /** Legacy field returned by older API versions. */
  video_url?: string | null;
}

// Status codes that mean the bot can never produce a recording.
const FAILED_CODES = new Set([
  "fatal",
  "recording_permission_denied",
  "media_expired",
]);

// Status codes that mean the bot is (or was) actively recording / the call has
// ended and media is being processed.
const RECORDING_CODES = new Set([
  "in_call_recording",
  "recording_permission_allowed",
  "recording_done",
  "call_ended",
  "done",
  "analysis_done",
]);

function snippet(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function extractAudioUrl(bot: RecallBot): string | undefined {
  for (const recording of bot.recordings ?? []) {
    const shortcuts = recording?.media_shortcuts;
    const url =
      shortcuts?.audio_mixed?.data?.download_url ??
      shortcuts?.video_mixed?.data?.download_url;
    if (url) return url;
  }
  // Legacy API shape: a flat video_url on the bot once the call ends.
  return bot.video_url ?? undefined;
}

export class RecallCaptureProvider implements CaptureProvider {
  constructor(private readonly config: AppConfig) {}

  private requireKey(): string {
    const key = this.config.recallApiKey;
    if (!key) {
      throw new Error(
        "RECALL_API_KEY is not set: add your Recall.ai API key to the environment " +
          "(see README: going live) or run with MOCK_MODE=true."
      );
    }
    return key;
  }

  private baseUrl(): string {
    return `https://${this.config.recallRegion}.recall.ai/api/v1`;
  }

  private async request<T>(
    path: string,
    init?: { method?: "GET" | "POST"; body?: unknown }
  ): Promise<T> {
    const key = this.requireKey();
    const method = init?.method ?? "GET";
    const url = `${this.baseUrl()}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Token ${key}`,
        accept: "application/json",
        ...(init?.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Recall.ai ${method} ${path} failed with HTTP ${res.status}: ${snippet(body) || "(empty body)"}`
      );
    }
    return (await res.json()) as T;
  }

  async createBot(
    meetingUrl: string,
    meetingId: string
  ): Promise<{ botId: string }> {
    const bot = await this.request<RecallBot>("/bot/", {
      method: "POST",
      body: {
        meeting_url: meetingUrl,
        bot_name: "CivicScribe",
        metadata: { civicscribe_meeting_id: meetingId },
        // Mixed-down single MP3 of the whole call — the simplest artifact to
        // feed straight into transcription.
        recording_config: {
          audio_mixed_mp3: {},
        },
      },
    });

    if (typeof bot.id !== "string" || bot.id === "") {
      throw new Error(
        `Recall.ai POST /bot/ succeeded but the response had no bot id: ${snippet(JSON.stringify(bot))}`
      );
    }
    return { botId: bot.id };
  }

  async getBotStatus(botId: string): Promise<{
    status: BotStatus;
    audioUrl?: string;
    error?: string;
  }> {
    const bot = await this.request<RecallBot>(`/bot/${botId}/`);

    const changes = bot.status_changes ?? [];
    const latest = changes.length > 0 ? changes[changes.length - 1] : undefined;
    const code = latest?.code ?? "";

    if (FAILED_CODES.has(code)) {
      const detail =
        latest?.message ?? latest?.sub_code ?? `bot status code "${code}"`;
      return { status: "failed", error: `Recall.ai bot failed: ${detail}` };
    }

    // If a downloadable recording exists, the capture is done regardless of
    // which post-call status code the bot is currently in.
    const audioUrl = extractAudioUrl(bot);
    if (audioUrl) {
      return { status: "done", audioUrl };
    }

    if (RECORDING_CODES.has(code)) {
      // Recording (or call ended and media still processing) — keep polling.
      return { status: "recording" };
    }

    // ready / joining_call / in_waiting_room / in_call_not_recording / unknown
    return { status: "joining" };
  }

  async downloadAudio(
    audioUrl: string
  ): Promise<{ data: Buffer; contentType: string }> {
    // Recording download URLs are pre-signed; no Authorization header (an
    // extra auth header can make pre-signed S3 URLs reject the request).
    const res = await fetch(audioUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Recall.ai recording download failed with HTTP ${res.status}: ${snippet(body) || "(empty body)"}`
      );
    }
    const data = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    return { data, contentType };
  }
}
