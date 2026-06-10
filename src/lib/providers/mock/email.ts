// Mock Resend email provider. Logs a formatted "would send" block to the
// server console instead of sending anything.

import type { EmailProvider } from "@/lib/providers/types";
import type { Meeting, Summary } from "@/lib/types";

export class MockEmailProvider implements EmailProvider {
  async sendCompletionEmail(
    to: string,
    meeting: Meeting,
    summary: Summary | null
  ): Promise<void> {
    const divider = "=".repeat(64);
    const overview = summary
      ? summary.overview.length > 160
        ? `${summary.overview.slice(0, 160)}...`
        : summary.overview
      : "(no summary available)";
    const lines = [
      divider,
      "[MockEmailProvider] Would send completion email",
      `  To:        ${to}`,
      `  Subject:   CivicScribe: "${meeting.title}" is ready`,
      `  Meeting:   ${meeting.title} — ${meeting.body_name}`,
      `  Status:    ${meeting.status}`,
      `  Duration:  ${
        meeting.duration_seconds != null
          ? `${Math.round(meeting.duration_seconds / 60)} min`
          : "unknown"
      }`,
      `  Link:      /meetings/${meeting.id}`,
      `  Decisions: ${summary ? summary.key_decisions.length : 0}`,
      `  Actions:   ${summary ? summary.action_items.length : 0}`,
      `  Overview:  ${overview}`,
      divider,
    ];
    console.log(lines.join("\n"));
  }
}
