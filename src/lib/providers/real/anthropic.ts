// Real SummaryProvider backed by the Anthropic API via @anthropic-ai/sdk.
// Uses structured outputs (output_config.format json_schema) so the model is
// constrained to the MeetingSummaryContent shape, then validates with zod and
// retries once with an explicit "return only valid JSON" reminder on a parse
// or validation failure.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { AppConfig } from "@/lib/config";
import type { SummaryInput, SummaryProvider } from "@/lib/providers/types";
import type { MeetingKind, MeetingSummaryContent } from "@/lib/types";
import { log } from "@/lib/logger";
import { estimateAnthropicUsd } from "@/lib/spend";

const MAX_TOKENS = 8_192;

const SYSTEM_PROMPT = `You are an expert civic meeting summarizer for CivicScribe, an accessibility-first archive built for a hard-of-hearing resident who could not attend the meeting live.

You will receive a diarized transcript of a public government meeting (city council, planning commission, school board, etc.). Produce a faithful, neutral, plain-language summary as a single JSON object with exactly these fields:

- "overview": 2-4 short paragraphs in plain language covering what the meeting was about and what happened. No jargon without explanation.
- "key_decisions": an array of strings, one per formal decision — votes, approvals, denials, adopted ordinances/resolutions, appointments. Include the outcome and vote tally when stated (e.g. "Approved rezoning of 12 Oak St from R-1 to R-2 (5-2)"). Empty array if none.
- "action_items": an array of strings, one per concrete follow-up or commitment, naming the responsible party and deadline when stated. Empty array if none.
- "topics": an array of short topic tags (2-5 words each) covering everything substantively discussed, including public comment themes.
- "full_markdown": a complete narrative summary in Markdown with headed sections (e.g. ## Overview, ## Decisions, ## Public Comment, ## Action Items), written so someone who missed the meeting fully understands what occurred.

Rules: only report what the transcript supports — never invent names, votes, or outcomes. Attribute statements to speaker labels as given. Respond with the JSON object only.`;

// Crash Course Corner: the same JSON schema, but reframed as study notes for an
// educational video. The "key_decisions" slot carries key concepts and the
// "action_items" slot carries takeaways (the UI relabels them accordingly).
const COURSE_SYSTEM_PROMPT = `You are an expert study-notes writer for CivicScribe's Crash Course Corner. You help a busy learner digest an educational video — a tutorial, lecture, talk, or explainer — quickly, without watching it.

You will receive a transcript of the video (it has no speaker labels). Produce faithful, plain-language study notes as a single JSON object with exactly these fields:

- "overview": a tight TL;DR in 2-4 short paragraphs — what the video teaches and the main thread of the explanation or walkthrough.
- "key_decisions": an array of strings, one per KEY CONCEPT the video teaches — the core ideas, definitions, techniques, steps, or claims the learner should understand. Empty array if none.
- "action_items": an array of strings, one per KEY TAKEAWAY — things to remember, try, or do next based on the video. Empty array if none.
- "topics": an array of short subject tags (2-5 words each) covering what the video covers.
- "full_markdown": complete study notes in Markdown with headed sections (e.g. ## TL;DR, ## Key concepts, ## Key takeaways, ## Worth remembering), written so the learner fully grasps the material without watching.

Rules: only report what the transcript supports — never invent facts, names, numbers, or claims. Respond with the JSON object only.`;

/** Civic summary prompt by default; the study-notes prompt for course videos. */
export function buildSystemPrompt(kind: MeetingKind | undefined): string {
  return kind === "course" ? COURSE_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

// JSON Schema for output_config.format — mirrors MeetingSummaryContent.
const MEETING_SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "overview",
    "key_decisions",
    "action_items",
    "topics",
    "full_markdown",
  ],
  properties: {
    overview: {
      type: "string",
      description: "Plain-language overview of the meeting (2-4 paragraphs).",
    },
    key_decisions: {
      type: "array",
      items: { type: "string" },
      description: "Formal decisions, votes, and approvals with outcomes.",
    },
    action_items: {
      type: "array",
      items: { type: "string" },
      description: "Concrete follow-ups with owners/deadlines when stated.",
    },
    topics: {
      type: "array",
      items: { type: "string" },
      description: "Short topic tags for everything substantively discussed.",
    },
    full_markdown: {
      type: "string",
      description: "Full narrative summary in Markdown with headed sections.",
    },
  },
};

// Runtime validation of the parsed JSON (zod v4).
const meetingSummarySchema = z.object({
  overview: z.string(),
  key_decisions: z.array(z.string()),
  action_items: z.array(z.string()),
  topics: z.array(z.string()),
  full_markdown: z.string(),
});

/** Strip ``` / ```json fences and isolate the outermost JSON object. */
function stripCodeFences(text: string): string {
  let t = text.trim();
  const fenced = t.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) t = fenced[1].trim();
  return t;
}

class SummaryParseError extends Error {}

function parseSummaryText(text: string): MeetingSummaryContent {
  const cleaned = stripCodeFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Last-ditch: slice from the first "{" to the last "}" in case the model
    // wrapped the JSON in prose despite instructions.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) {
      throw new SummaryParseError(
        `Summary response was not valid JSON: ${cleaned.slice(0, 200)}…`
      );
    }
    try {
      parsed = JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      throw new SummaryParseError(
        `Summary response was not valid JSON: ${cleaned.slice(0, 200)}…`
      );
    }
  }

  const result = meetingSummarySchema.safeParse(parsed);
  if (!result.success) {
    throw new SummaryParseError(
      `Summary JSON did not match the MeetingSummaryContent schema: ${result.error.message}`
    );
  }
  return result.data;
}

export function buildUserContent(input: SummaryInput): string {
  const diarized = input.diarized ?? true;
  const transcript = diarized
    ? input.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
    : input.utterances.map((u) => u.text).join("\n");
  return [
    `Meeting title: ${input.meetingTitle}`,
    `Public body: ${input.bodyName}`,
    "",
    diarized
      ? "Diarized transcript:"
      : "Transcript (auto-captions, no speaker labels):",
    transcript,
  ].join("\n");
}

export class AnthropicSummaryProvider implements SummaryProvider {
  private client: Anthropic | null = null;

  constructor(private readonly config: AppConfig) {}

  private getClient(): Anthropic {
    const key = this.config.anthropicApiKey;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — add your Anthropic API key to the environment " +
          "(see README: going live) or run with MOCK_MODE=true."
      );
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey: key });
    }
    return this.client;
  }

  async summarize(input: SummaryInput): Promise<MeetingSummaryContent> {
    const client = this.getClient();
    const baseContent = buildUserContent(input);

    let lastParseError: SummaryParseError | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const userContent =
        attempt === 0
          ? baseContent
          : `${baseContent}\n\nIMPORTANT: Your previous reply could not be parsed. ` +
            "Return ONLY a single valid JSON object matching the required schema — " +
            "no prose, no markdown, no code fences.";

      // API/network errors propagate (the SDK already retries transient ones);
      // only parse/validation failures trigger the single retry below.
      // output_config.format is a typed param in @anthropic-ai/sdk ^0.104 —
      // no cast needed.
      const response = await client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(input.kind),
        messages: [{ role: "user", content: userContent }],
        output_config: {
          format: {
            type: "json_schema",
            schema: MEETING_SUMMARY_JSON_SCHEMA,
          },
        },
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (!textBlock) {
        lastParseError = new SummaryParseError(
          `Anthropic response contained no text block (stop_reason: ${response.stop_reason ?? "unknown"}).`
        );
        continue;
      }

      try {
        const summary = parseSummaryText(textBlock.text);
        // Per-job spend logging (observability only): token usage + an
        // estimated USD for this summary. Logged on success so the global daily
        // spend is observable once real keys are on.
        const inputTokens = response.usage?.input_tokens ?? 0;
        const outputTokens = response.usage?.output_tokens ?? 0;
        log.info("anthropic: summary spend", {
          model: this.config.anthropicModel,
          inputTokens,
          outputTokens,
          estimatedUsd: Number(
            estimateAnthropicUsd(inputTokens, outputTokens).toFixed(4)
          ),
          attempt: attempt + 1,
        });
        return summary;
      } catch (err) {
        if (err instanceof SummaryParseError) {
          lastParseError = err;
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Anthropic summary failed after retry: ${lastParseError?.message ?? "unknown parse failure"}`
    );
  }
}
