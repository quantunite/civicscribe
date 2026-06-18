// Real SummaryProvider backed by the Anthropic API via @anthropic-ai/sdk.
// Uses structured outputs (output_config.format json_schema) so the model is
// constrained to the MeetingSummaryContent shape, then validates with zod and
// retries once with an explicit "return only valid JSON" reminder on a parse
// or validation failure.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { AppConfig } from "@/lib/config";
import type {
  CatchUpInput,
  SummaryInput,
  SummaryProvider,
  TopicSynthesisInput,
} from "@/lib/providers/types";
import type { MeetingKind, MeetingSummaryContent } from "@/lib/types";
import { log } from "@/lib/logger";
import { estimateAnthropicUsd } from "@/lib/spend";

const MAX_TOKENS = 8_192;

const SYSTEM_PROMPT = `You are an expert civic meeting summarizer for CivicScribe, an accessibility-first archive built for a hard-of-hearing resident who could not attend the meeting live.

You will receive a diarized transcript of a public government meeting (city council, planning commission, school board, etc.). Produce a faithful, neutral, plain-language summary as a single JSON object with exactly these fields:

- "overview": 2-4 short paragraphs in plain language covering what the meeting was about and what happened. No jargon without explanation.
- "key_decisions": an array of strings, one per formal decision — votes, approvals, denials, adopted ordinances/resolutions, appointments. Include the outcome and vote tally when stated (e.g. "Approved rezoning of 12 Oak St from R-1 to R-2 (5-2)"). Empty array if none.
- "action_items": an array of strings, one per concrete follow-up or commitment, naming the responsible party and deadline when stated. Empty array if none.
- "topics": an array of short SUBJECT-MATTER tags (2-5 words each) naming the substantive issues, policies, projects, places, and public-comment THEMES discussed — the things a resident would actually search for. Do NOT tag routine procedural or administrative business that has no subject matter: exclude roll call, attendance, quorum, approval of the agenda or minutes, the pledge of allegiance, invocations, recesses, announcements, old/new business headings, and adjournment. Prefer a few precise topics over an exhaustive list.
- "full_markdown": a complete narrative summary in Markdown with headed sections (e.g. ## Overview, ## Decisions, ## Public Comment, ## Action Items), written so someone who missed the meeting fully understands what occurred.

Rules: only report what the transcript supports — never invent names, votes, or outcomes. Attribute statements to speaker labels as given. Respond with the JSON object only.`;

// Study Notes: the same JSON schema, but reframed as study notes for an
// educational video. The "key_decisions" slot carries key concepts and the
// "action_items" slot carries takeaways (the UI relabels them accordingly).
const COURSE_SYSTEM_PROMPT = `You are an expert study-notes writer for CivicScribe's Study Notes feature. You help a busy learner digest an educational video — a tutorial, lecture, talk, or explainer — quickly, without watching it.

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

// Phase 3 cross-meeting synthesis. Plain Markdown output (no JSON schema), built
// only from the published meeting summaries handed in. Grounded-only, no em dash.
const SYNTHESIS_SYSTEM_PROMPT = `You are a civic-knowledge synthesist for CivicScribe. You are given several PUBLISHED meeting summaries that all touch one topic. Write a single Markdown synthesis of what was discussed about that topic ACROSS these meetings, for a resident who wants the throughline without reading every meeting.

Cover, using Markdown headings:
- The throughline: what this topic is about across the meetings.
- How the discussion evolved over time (reference meetings by title and date).
- Points of agreement and points of tension.
- Open questions and what remains unresolved.

Rules: stay grounded only in the material provided. Do not invent decisions, names, votes, or dates. Reference meetings inline by their title and date. Write plainly. Do not use the long dash character; use commas, colons, or parentheses instead.`;

/** Serialize the synthesis input into a single user-message string (exported so
 *  it can be unit-tested without the SDK). Each meeting becomes a small section. */
export function buildSynthesisUserContent(input: TopicSynthesisInput): string {
  const parts: string[] = [
    `Topic: ${input.topic}`,
    "",
    `You are given ${input.meetings.length} published meetings that touch this topic, oldest reference first.`,
    "",
  ];
  for (const m of input.meetings) {
    parts.push(`### ${m.title} (${m.date})`);
    parts.push(`Overview: ${m.overview}`);
    if (m.keyPoints.length > 0) {
      parts.push("Key points:");
      for (const point of m.keyPoints) parts.push(`- ${point}`);
    } else {
      parts.push("Key points: none recorded.");
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

// Live "catch me up" recap. The meeting is IN PROGRESS; we feed the prior recap
// (may be empty) plus only the newest transcript lines so input stays bounded.
// Plain text out (no JSON, no Markdown headings). No em dash (project rule).
const CATCHUP_SYSTEM_PROMPT = `You are CivicScribe's live "catch me up" writer. A public government meeting is IN PROGRESS and a resident just opened the live page. Write a single short recap of what they missed so far.

You are given the recap so far (it may be empty for the first update) and the newest live transcript lines. Update the recap so it reflects everything covered up to now: extend it with what the new lines add, and keep it to one concise paragraph of 3 to 6 sentences.

Rules:
- Plain English for a resident who just joined. No jargon, no acronyms without a plain-word explanation.
- Cover what has been discussed and any decisions or votes taken so far. Note that the meeting is still ongoing.
- The live transcript is auto-generated and may be rough; only state what the lines support, and never invent names, votes, or outcomes.
- Return plain text only: no markdown headings, no bullet list, no JSON.
- Do not use the long dash character; use commas, colons, or parentheses instead.`;

/** Serialize a catch-up request into a single user-message string (exported so
 *  it can be unit-tested without the SDK). */
export function buildCatchUpUserContent(input: CatchUpInput): string {
  const lines = input.newLines
    .map((l) => `${l.speaker}: ${l.text}`)
    .join("\n");
  return [
    `Meeting title: ${input.meetingTitle}`,
    `Public body: ${input.bodyName}`,
    "",
    "Recap so far:",
    input.priorSummary && input.priorSummary.trim() !== ""
      ? input.priorSummary
      : "(none yet — this is the first update)",
    "",
    "Newest live transcript lines:",
    lines,
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

  async synthesizeTopic(input: TopicSynthesisInput): Promise<string> {
    const client = this.getClient();

    // Plain Markdown output, so no output_config.format (no JSON parsing/retry).
    // API/network errors propagate (the SDK already retries transient ones).
    const response = await client.messages.create({
      model: this.config.anthropicModel,
      max_tokens: MAX_TOKENS,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSynthesisUserContent(input) }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    if (!textBlock) {
      throw new Error(
        `Anthropic synthesis response contained no text block (stop_reason: ${response.stop_reason ?? "unknown"}).`
      );
    }

    // Per-call spend logging (observability only), matching summarize().
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    log.info("anthropic: synthesis spend", {
      model: this.config.anthropicModel,
      inputTokens,
      outputTokens,
      estimatedUsd: Number(
        estimateAnthropicUsd(inputTokens, outputTokens).toFixed(4)
      ),
    });

    return textBlock.text.trim();
  }

  async catchUp(input: CatchUpInput): Promise<string> {
    const client = this.getClient();

    // Plain text output, so no output_config.format (no JSON parsing/retry). The
    // recap is short, so a tight max_tokens keeps each refresh cheap. API/network
    // errors propagate; the caller (maybeRefreshCatchUp) is best-effort and never
    // lets them surface to the poll response.
    const response = await client.messages.create({
      model: this.config.anthropicModel,
      max_tokens: 1_024,
      system: CATCHUP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCatchUpUserContent(input) }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    if (!textBlock) {
      throw new Error(
        `Anthropic catch-up response contained no text block (stop_reason: ${response.stop_reason ?? "unknown"}).`
      );
    }

    // Per-call spend logging (observability only), matching summarize().
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    log.info("anthropic: catch-up spend", {
      model: this.config.anthropicModel,
      inputTokens,
      outputTokens,
      estimatedUsd: Number(
        estimateAnthropicUsd(inputTokens, outputTokens).toFixed(4)
      ),
    });

    return textBlock.text.trim();
  }
}
