// Summary JSON parsing in the real Anthropic SummaryProvider, with the SDK
// faked via vi.mock. Covers clean JSON, code-fenced JSON, prose-wrapped JSON,
// the single retry on a malformed first response, and the terminal failure
// when both attempts are malformed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryInput } from "@/lib/providers/types";
import type { MeetingSummaryContent } from "@/lib/types";
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

// Import AFTER vi.mock so the provider binds to the fake SDK (vi.mock is
// hoisted above imports anyway, but keep the intent obvious).
import { AnthropicSummaryProvider } from "@/lib/providers/real/anthropic";

const VALID_SUMMARY: MeetingSummaryContent = {
  overview: "The council met and approved the minutes and one zoning variance.",
  key_decisions: ["Approved variance Z-2026-014 (3-0)"],
  action_items: ["Engineering to review the drainage plan before permits"],
  topics: ["zoning variance", "drainage"],
  full_markdown: "## Overview\nThe council met.\n\n## Decisions\n- Approved.",
};

const SUMMARY_INPUT: SummaryInput = {
  meetingTitle: "Regular Session",
  bodyName: "Lawrence City Council",
  utterances: [
    { speaker: "Mayor Whitfield", text: "I call this meeting to order." },
    { speaker: "B", text: "So moved." },
  ],
};

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  };
}

function makeProvider() {
  return new AnthropicSummaryProvider(
    testConfig({ anthropicApiKey: "test-anthropic-key" })
  );
}

/** The user-message content string sent on the Nth (0-based) API call. */
function sentUserContent(callIndex: number): string {
  const call = createMock.mock.calls[callIndex]?.[0] as {
    messages: Array<{ role: string; content: string }>;
  };
  return call.messages[0].content;
}

beforeEach(() => {
  createMock.mockReset();
});

describe("AnthropicSummaryProvider.summarize", () => {
  it("parses a clean JSON response on the first attempt", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(JSON.stringify(VALID_SUMMARY))
    );

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(1);
    // The transcript and metadata made it into the prompt.
    expect(sentUserContent(0)).toContain("Regular Session");
    expect(sentUserContent(0)).toContain("Lawrence City Council");
    expect(sentUserContent(0)).toContain(
      "Mayor Whitfield: I call this meeting to order."
    );
  });

  it("parses JSON wrapped in ```json code fences", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        "```json\n" + JSON.stringify(VALID_SUMMARY, null, 2) + "\n```"
      )
    );

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("parses JSON wrapped in bare ``` fences", async () => {
    createMock.mockResolvedValueOnce(
      textResponse("```\n" + JSON.stringify(VALID_SUMMARY) + "\n```")
    );

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("parses JSON embedded in surrounding prose (first { to last })", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        `Here is the summary you asked for: ${JSON.stringify(VALID_SUMMARY)} Hope that helps!`
      )
    );

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once after a malformed first response, with a JSON-only reminder", async () => {
    createMock
      .mockResolvedValueOnce(textResponse("Sorry, I cannot produce JSON today."))
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(2);
    // First call: plain prompt, no retry note.
    expect(sentUserContent(0)).not.toContain("could not be parsed");
    // Second call: same prompt plus the explicit JSON-only reminder.
    expect(sentUserContent(1)).toContain("could not be parsed");
    expect(sentUserContent(1)).toContain(
      "Return ONLY a single valid JSON object"
    );
  });

  it("retries when JSON is valid but fails schema validation, then succeeds", async () => {
    const wrongShape = { ...VALID_SUMMARY, key_decisions: "not an array" };
    createMock
      .mockResolvedValueOnce(textResponse(JSON.stringify(wrongShape)))
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("retries when the response has no text block at all", async () => {
    createMock
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t", name: "x", input: {} }],
        stop_reason: "end_turn",
      })
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_SUMMARY)));

    const result = await makeProvider().summarize(SUMMARY_INPUT);

    expect(result).toEqual(VALID_SUMMARY);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws after two malformed responses, with the parse failure surfaced", async () => {
    createMock
      .mockResolvedValueOnce(textResponse("not json, attempt one"))
      .mockResolvedValueOnce(textResponse("still not json, attempt two"));

    await expect(makeProvider().summarize(SUMMARY_INPUT)).rejects.toThrow(
      /Anthropic summary failed after retry: .*not valid JSON/
    );
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("propagates API errors without retrying (SDK handles transient retries)", async () => {
    createMock.mockRejectedValueOnce(new Error("529 overloaded"));

    await expect(makeProvider().summarize(SUMMARY_INPUT)).rejects.toThrow(
      "529 overloaded"
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast with a clear message when the API key is missing — no API call", async () => {
    const provider = new AnthropicSummaryProvider(
      testConfig({ anthropicApiKey: null })
    );

    await expect(provider.summarize(SUMMARY_INPUT)).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
    expect(createMock).not.toHaveBeenCalled();
  });
});
