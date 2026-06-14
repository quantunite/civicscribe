// Per-job spend ESTIMATES for observability only — never billing.
//
// These are rough USD figures logged alongside each paid job so the global
// daily spend is observable once real keys are on. The rates are constants, not
// live pricing; they will drift and are intentionally approximate. Treat the
// logged dollar figures as an order-of-magnitude signal, not an invoice.

// Anthropic pricing for the default summary model (claude-sonnet-4-6):
// $3.00 per 1M input tokens, $15.00 per 1M output tokens (per Anthropic's
// published pricing). If ANTHROPIC_MODEL is overridden these rates no longer
// match — update them, or treat the estimate as a lower/upper bound.
export const ANTHROPIC_USD_PER_MTOK_INPUT = 3.0;
export const ANTHROPIC_USD_PER_MTOK_OUTPUT = 15.0;

// AssemblyAI async transcription with speaker diarization, billed per audio
// hour (per AssemblyAI's published per-second rate, ~ $0.27/hr at time of
// writing). Estimate only; reconcile against the real invoice.
export const ASSEMBLYAI_USD_PER_HOUR = 0.27;

/** Non-negative finite number, else 0 (defensive against null/NaN/negatives). */
function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Estimated USD for one Anthropic summary call from its token usage. */
export function estimateAnthropicUsd(
  inputTokens: number,
  outputTokens: number
): number {
  const input = clampNonNeg(inputTokens);
  const output = clampNonNeg(outputTokens);
  return (
    (input / 1_000_000) * ANTHROPIC_USD_PER_MTOK_INPUT +
    (output / 1_000_000) * ANTHROPIC_USD_PER_MTOK_OUTPUT
  );
}

/** Estimated USD for transcribing `durationSeconds` of audio via AssemblyAI. */
export function estimateAssemblyAiUsd(durationSeconds: number | null): number {
  const seconds = clampNonNeg(durationSeconds ?? 0);
  return (seconds / 3600) * ASSEMBLYAI_USD_PER_HOUR;
}
