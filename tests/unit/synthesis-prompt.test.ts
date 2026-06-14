// The real Anthropic synthesizeTopic path, with the SDK faked. Covers the pure
// user-content builder, the plain-text (non-JSON) markdown return, the system
// prompt content (and no em dash), and the fail-fast when the API key is missing.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TopicSynthesisInput } from "@/lib/providers/types";
import { testConfig } from "./helpers";

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(_opts: { apiKey: string }) {
      void _opts;
    }
  }
  return { default: FakeAnthropic };
});

import {
  AnthropicSummaryProvider,
  buildSynthesisUserContent,
} from "@/lib/providers/real/anthropic";

const EM_DASH = "—";

const INPUT: TopicSynthesisInput = {
  topic: "Zoning",
  meetings: [
    {
      title: "January Council",
      date: "2026-01-05T00:00:00.000Z",
      overview: "Discussed the Oak Street rezoning.",
      keyPoints: ["Approved variance Z-1 (5-2)"],
    },
    {
      title: "February Council",
      date: "2026-02-09T00:00:00.000Z",
      overview: "Revisited downtown zoning overlay.",
      keyPoints: ["Tabled the overlay", "Set a March hearing"],
    },
  ],
};

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function makeProvider() {
  return new AnthropicSummaryProvider(
    testConfig({ anthropicApiKey: "test-anthropic-key" })
  );
}

beforeEach(() => {
  createMock.mockReset();
});

describe("buildSynthesisUserContent", () => {
  it("includes the topic, and each meeting's title, date, overview, and key points", () => {
    const content = buildSynthesisUserContent(INPUT);
    expect(content).toContain("Zoning");
    expect(content).toContain("January Council");
    expect(content).toContain("February Council");
    expect(content).toContain("2026-01-05T00:00:00.000Z");
    expect(content).toContain("Discussed the Oak Street rezoning.");
    expect(content).toContain("Approved variance Z-1 (5-2)");
    expect(content).toContain("Tabled the overlay");
    expect(content).toContain("Set a March hearing");
  });

  it("does not emit an em dash", () => {
    expect(buildSynthesisUserContent(INPUT)).not.toContain(EM_DASH);
  });
});

describe("AnthropicSummaryProvider.synthesizeTopic", () => {
  it("returns the model's markdown text (no JSON parsing) and calls the API once", async () => {
    createMock.mockResolvedValueOnce(
      textResponse("## Synthesis\n\nThe throughline across meetings.")
    );

    const out = await makeProvider().synthesizeTopic(INPUT);

    expect(out).toBe("## Synthesis\n\nThe throughline across meetings.");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("trims surrounding whitespace from the returned text", async () => {
    createMock.mockResolvedValueOnce(textResponse("\n  ## Synthesis  \n"));
    const out = await makeProvider().synthesizeTopic(INPUT);
    expect(out).toBe("## Synthesis");
  });

  it("sends a synthesis system prompt that does not use JSON output_config and has no em dash", async () => {
    createMock.mockResolvedValueOnce(textResponse("## Synthesis"));
    await makeProvider().synthesizeTopic(INPUT);

    const call = createMock.mock.calls[0][0] as {
      system: string;
      output_config?: unknown;
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.system.toLowerCase()).toContain("synthes");
    expect(call.system).not.toContain(EM_DASH);
    // Plain markdown output, so no JSON schema is forced.
    expect(call.output_config).toBeUndefined();
    expect(call.messages[0].content).toContain("January Council");
  });

  it("throws when the response has no text block", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t", name: "x", input: {} }],
      stop_reason: "end_turn",
    });
    await expect(makeProvider().synthesizeTopic(INPUT)).rejects.toThrow(
      /no text block/i
    );
  });

  it("fails fast with a clear message when the API key is missing, with no API call", async () => {
    const provider = new AnthropicSummaryProvider(
      testConfig({ anthropicApiKey: null })
    );
    await expect(provider.synthesizeTopic(INPUT)).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
    expect(createMock).not.toHaveBeenCalled();
  });
});
