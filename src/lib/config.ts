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
  };
}
