// The structured summary uses the same field names for both kinds, but they
// mean different things: for course videos the "key_decisions" slot holds key
// concepts and "action_items" holds takeaways. This is the single source of
// truth for how those two sections are labelled in the UI and in exports.

import type { MeetingKind } from "@/lib/types";

export interface SummaryLabels {
  /** Heading for the key_decisions array. */
  keyPoints: string;
  /** Heading for the action_items array. */
  takeaways: string;
}

export function summaryLabels(kind: MeetingKind): SummaryLabels {
  return kind === "course"
    ? { keyPoints: "Key concepts", takeaways: "Key takeaways" }
    : { keyPoints: "Key decisions", takeaways: "Action items" };
}
