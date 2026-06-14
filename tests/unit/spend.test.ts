// Spend estimators (src/lib/spend.ts). Rough USD estimates used only for
// observability logging — never billing. The rates are constants; these tests
// pin the arithmetic and the rounding/guard behavior, not the exact prices.

import { describe, expect, it } from "vitest";

import {
  estimateAnthropicUsd,
  estimateAssemblyAiUsd,
  ANTHROPIC_USD_PER_MTOK_INPUT,
  ANTHROPIC_USD_PER_MTOK_OUTPUT,
  ASSEMBLYAI_USD_PER_HOUR,
} from "@/lib/spend";

describe("estimateAnthropicUsd", () => {
  it("sums input and output cost at the per-million-token rates", () => {
    const input = 1_000_000;
    const output = 500_000;
    const expected =
      ANTHROPIC_USD_PER_MTOK_INPUT * 1 + ANTHROPIC_USD_PER_MTOK_OUTPUT * 0.5;
    expect(estimateAnthropicUsd(input, output)).toBeCloseTo(expected, 6);
  });

  it("is zero for zero tokens", () => {
    expect(estimateAnthropicUsd(0, 0)).toBe(0);
  });

  it("treats negative/NaN token counts as zero (defensive)", () => {
    expect(estimateAnthropicUsd(-100, Number.NaN)).toBe(0);
  });
});

describe("estimateAssemblyAiUsd", () => {
  it("charges per audio hour pro-rated by seconds", () => {
    expect(estimateAssemblyAiUsd(3600)).toBeCloseTo(ASSEMBLYAI_USD_PER_HOUR, 6);
    expect(estimateAssemblyAiUsd(1800)).toBeCloseTo(
      ASSEMBLYAI_USD_PER_HOUR / 2,
      6
    );
  });

  it("is zero for zero/unknown duration", () => {
    expect(estimateAssemblyAiUsd(0)).toBe(0);
    expect(estimateAssemblyAiUsd(null)).toBe(0);
  });

  it("treats negative/NaN duration as zero (defensive)", () => {
    expect(estimateAssemblyAiUsd(-60)).toBe(0);
    expect(estimateAssemblyAiUsd(Number.NaN)).toBe(0);
  });
});
