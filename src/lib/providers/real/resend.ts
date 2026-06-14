// Real EmailProvider backed by Resend (https://resend.com).
// Per the spec this provider is deliberately stub-friendly: when
// RESEND_API_KEY is missing it logs the email to the console (dev behavior)
// instead of throwing, so the notify stage never blocks the pipeline.

import type { AppConfig } from "@/lib/config";
import type { EmailProvider } from "@/lib/providers/types";
import type { Meeting, Summary } from "@/lib/types";

// Resend's sandbox sender — works without a verified domain for testing.
// Swap for a verified-domain address when going to production.
const FROM_ADDRESS = "CivicScribe <onboarding@resend.dev>";

function snippet(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly config: AppConfig) {}

  private meetingLink(meeting: Meeting): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}/meetings/${meeting.id}`;
  }

  async sendCompletionEmail(
    to: string,
    meeting: Meeting,
    summary: Summary | null
  ): Promise<void> {
    const link = this.meetingLink(meeting);
    const subject = `[CivicScribe] ${meeting.title}: ${meeting.status}`;

    if (!this.config.resendApiKey) {
      // Dev stub: no key, no send — log instead (spec'd behavior).
      console.log(
        "[CivicScribe email stub] RESEND_API_KEY not set — logging instead of sending."
      );
      console.log(`[CivicScribe email stub] To: ${to}`);
      console.log(`[CivicScribe email stub] Subject: ${subject}`);
      console.log(
        `[CivicScribe email stub] Meeting "${meeting.title}" (${meeting.body_name}) is now "${meeting.status}".`
      );
      if (summary?.overview) {
        console.log(
          `[CivicScribe email stub] Overview: ${snippet(summary.overview)}`
        );
      }
      console.log(`[CivicScribe email stub] View it at: ${link}`);
      return;
    }

    const html = [
      `<h2>${escapeHtml(meeting.title)}</h2>`,
      `<p><strong>${escapeHtml(meeting.body_name)}</strong>, status: <strong>${escapeHtml(meeting.status)}</strong></p>`,
      summary?.overview
        ? `<p>${escapeHtml(summary.overview)}</p>`
        : "<p>No summary is available for this meeting.</p>",
      `<p><a href="${escapeHtml(link)}">Open the full transcript and summary</a></p>`,
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Resend POST /emails failed with HTTP ${res.status}: ${snippet(body) || "(empty body)"}`
      );
    }
  }
}
