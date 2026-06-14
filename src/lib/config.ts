// Central env/config access. Every external dependency is read here and only
// here. The app must boot with only MOCK_MODE=true set.

export interface AppConfig {
  mockMode: boolean;
  baseUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  assemblyAiApiKey: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string;
  recallApiKey: string | null;
  recallRegion: string;
  resendApiKey: string | null;
  notifyEmail: string | null;
  /** Local data dir used by the mock-mode file-backed store + local file storage. */
  dataDir: string;
  /** Try fetching an existing caption track before downloading audio (stream sources). */
  captionFastLane: boolean;
  /** Caption language preference order (manual beats auto within the first match). */
  captionLangs: string[];
  /** Hard timeout (ms) for a caption fetch before falling back to audio. */
  captionFetchTimeoutMs: number;
  /** Shared secret required to POST /api/jobs/tick. Null = open (dev default). */
  tickSecret: string | null;
  /** Shared secret (URL token) required for the Recall webhook. Null = open. */
  recallWebhookSecret: string | null;
  /** The single admin secret (cookie for the UI, Bearer for scripts). Null =
   *  open mode: the access layer is a complete no-op so dev + the test suite run
   *  unchanged. Set it to gate the admin surface for a public deploy. */
  ownerSecret: string | null;
}

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : null;
}

export function getConfig(): AppConfig {
  return {
    mockMode: process.env.MOCK_MODE === "true",
    baseUrl: env("APP_BASE_URL") ?? "http://localhost:3000",
    supabaseUrl: env("SUPABASE_URL"),
    supabaseAnonKey: env("SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    assemblyAiApiKey: env("ASSEMBLYAI_API_KEY"),
    anthropicApiKey: env("ANTHROPIC_API_KEY"),
    // The kickoff spec pinned claude-sonnet-4-20250514, which is deprecated
    // (retires 2026-06-15). claude-sonnet-4-6 is its official replacement.
    anthropicModel: env("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
    recallApiKey: env("RECALL_API_KEY"),
    recallRegion: env("RECALL_REGION") ?? "us-west-2",
    resendApiKey: env("RESEND_API_KEY"),
    notifyEmail: env("NOTIFY_EMAIL"),
    dataDir: env("DATA_DIR") ?? ".data",
    captionFastLane: (env("CAPTION_FASTLANE") ?? "true") !== "false",
    captionLangs: (env("CAPTION_LANGS") ?? "en,en-US,en-GB,en-orig")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    captionFetchTimeoutMs: Number(env("CAPTION_FETCH_TIMEOUT_MS") ?? "60000"),
    tickSecret: env("TICK_SECRET"),
    recallWebhookSecret: env("RECALL_WEBHOOK_SECRET"),
    ownerSecret: env("OWNER_SECRET"),
  };
}
