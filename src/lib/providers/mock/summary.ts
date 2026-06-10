// Mock Anthropic summary provider. Returns a clone of the fixture council
// summary instantly, regardless of input.

import { FIXTURE_COUNCIL_SUMMARY } from "@/lib/fixtures";
import type { SummaryInput, SummaryProvider } from "@/lib/providers/types";
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
}
