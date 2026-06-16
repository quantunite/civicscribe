// Mock Anthropic summary provider. Returns a clone of the fixture council
// summary instantly, regardless of input.

import { FIXTURE_COUNCIL_SUMMARY } from "@/lib/fixtures";
import type {
  CatchUpInput,
  SummaryInput,
  SummaryProvider,
  TopicSynthesisInput,
} from "@/lib/providers/types";
import type { MeetingSummaryContent } from "@/lib/types";

export class MockSummaryProvider implements SummaryProvider {
  async summarize(input: SummaryInput): Promise<MeetingSummaryContent> {
    void input; // mock ignores the transcript content
    // Clone so callers can never mutate the shared fixture object.
    return {
      overview: FIXTURE_COUNCIL_SUMMARY.overview,
      key_decisions: [...FIXTURE_COUNCIL_SUMMARY.key_decisions],
      action_items: [...FIXTURE_COUNCIL_SUMMARY.action_items],
      topics: [...FIXTURE_COUNCIL_SUMMARY.topics],
      full_markdown: FIXTURE_COUNCIL_SUMMARY.full_markdown,
    };
  }

  // Deterministic markdown that references each meeting, so MOCK_MODE admin
  // generation produces something meaningful and tests can assert on it.
  async synthesizeTopic(input: TopicSynthesisInput): Promise<string> {
    const lines: string[] = [
      `## Synthesis: ${input.topic}`,
      "",
      `This topic spans ${input.meetings.length} published meetings.`,
      "",
      "### Across the meetings",
      "",
    ];
    for (const m of input.meetings) {
      lines.push(`- **${m.title}** (${m.date}): ${m.overview}`);
    }
    return lines.join("\n");
  }

  // Deterministic plain-text recap (no network) so the live catch-up flow runs
  // in MOCK_MODE and tests can assert on it. Incorporates the new-line count and
  // whether a prior recap was present. No em dash.
  async catchUp(input: CatchUpInput): Promise<string> {
    const base = input.priorSummary
      ? "Continuing the recap"
      : "Here is what you missed so far";
    return (
      `${base}: the meeting "${input.meetingTitle}" (${input.bodyName}) is ` +
      `in progress, covering ${input.newLines.length} new line(s) since the ` +
      "last update. This is an automatic recap of the live transcript."
    );
  }
}
