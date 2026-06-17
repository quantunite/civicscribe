import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { createAndEnqueueCapture } from "@/lib/meetings/create";
import { isInternalHost, meetingHostError, parseHttpUrl } from "@/lib/net/url";
import { sourceKey } from "@/lib/net/source-key";
import { isStaffRequest } from "@/lib/owner";
import {
  signMeetingView,
  MEETING_VIEW_TTL_SECONDS,
} from "@/lib/auth/meeting-view";
import { enforceSubmitGuardrails } from "@/lib/guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    source_type: z.enum(["zoom", "teams", "meet", "stream"]),
    kind: z.enum(["civic", "course"]).optional(),
    source_url: z.string().trim().min(1, "source_url is required"),
    // Lawful-basis attestation (required): the submitter affirms either that this
    // is an open meeting of a public body, or that they have explicit authority
    // to record it and add it to the public library. A missing/invalid value
    // falls through to the existing 400 issues path.
    attestation: z.enum(["public", "authorized"]),
    // Live captions opt-in (bot sources only; forced false for stream below).
    live_enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const url = parseHttpUrl(data.source_url);
    if (!url) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message: "source_url must be a valid http(s) URL",
      });
      return;
    }
    if (data.source_type === "stream") {
      if (isInternalHost(url.hostname)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_url"],
          message:
            "source_url must point at a public host: localhost and private/internal addresses are not allowed",
        });
      }
    } else {
      const msg = meetingHostError(data.source_type, url);
      if (msg) {
        ctx.addIssue({ code: "custom", path: ["source_url"], message: msg });
      }
    }

    // Scope the recording BOT to public meetings: a bot joining a live call
    // records everyone present, so the "authorized" (private, by-authority)
    // basis is not sufficient for it. Bot sources (zoom/teams/meet) require the
    // public-meeting basis; a private recording you have authority over should be
    // uploaded instead.
    if (
      (data.source_type === "zoom" ||
        data.source_type === "teams" ||
        data.source_type === "meet") &&
      data.attestation !== "public"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["attestation"],
        message:
          "A recording bot can only join an open meeting of a public body. For a private meeting you have authority over, upload the recording or use a stream URL instead.",
      });
    }
  });

/**
 * GET /api/meetings: meetings newest first; optional ?kind=civic|course.
 *
 * Published-only is enforced server-side for non-admins: anyone who is not the
 * admin gets the public library feed (published only), regardless of any query
 * param, so the list can never leak unpublished/pending items. The admin gets
 * every meeting by default, or the published feed with ?published=true. When
 * OWNER_SECRET is unset, isAdminRequest is true for everyone (dev/single-user),
 * preserving the original "see everything" behavior.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const kindParam = params.get("kind");
    const kind =
      kindParam === "civic" || kindParam === "course" ? kindParam : undefined;
    const admin = await isStaffRequest(request);
    const wantsAll = admin && params.get("published") !== "true";
    const store = getStore();
    const meetings = wantsAll
      ? await store.listMeetings(kind)
      : await store.listLibrary({ kind });
    return NextResponse.json(meetings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list meetings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/meetings — create a zoom or stream meeting and enqueue capture. */
export async function POST(request: Request) {
  // Cost/abuse guardrails for public generation (admin-exempt; no-op when
  // OWNER_SECRET is unset). Enforced before any work so a capped caller never
  // reaches paid processing.
  const limited = enforceSubmitGuardrails(request);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json(
      {
        error: issues[0]?.message ?? "Invalid request",
        issues,
      },
      { status: 400 }
    );
  }

  try {
    const store = getStore();

    // Dedup short-circuit: a source we have already generated must not be
    // re-created or re-processed (that spends real money again). Surface the
    // existing meeting so the UI can show it instead.
    // TODO(tenant-scope): dedup is currently global on source_key. Once
    // tenant_id is populated, dedup should become tenant-scoped (composite
    // (tenant_id, source_key)) so two govs can each generate the same public
    // video independently. Update findBySourceKey + the partial UNIQUE index
    // (migration 0006) together.
    const key = sourceKey(parsed.data.source_url);
    const existing = await store.findBySourceKey(key);
    if (existing) {
      // Dedup short-circuit. A NEW create is what mints a VIEW token and what
      // returns the meeting; the dedup path must do NEITHER for a non-staff
      // caller. Otherwise mere knowledge of the source URL would hand any
      // resubmitter a (token-less) handle to someone else's pending meeting.
      // Return a neutral, id-less acknowledgement. Staff may still receive the
      // meeting for convenience (they can already read every meeting).
      if (await isStaffRequest(request)) {
        return NextResponse.json(
          { duplicate: true, meeting: existing },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          duplicate: true,
          message:
            "This meeting was already submitted. It will appear in the public library once staff approve it.",
        },
        { status: 200 }
      );
    }

    // New submission: created published=false (pending admin review). Live
    // captions only apply to bot sources; force false for a stream source.
    const liveEnabled =
      parsed.data.source_type !== "stream" && parsed.data.live_enabled === true;
    const meeting = await createAndEnqueueCapture(store, {
      title: parsed.data.title,
      body_name: parsed.data.body_name,
      source_type: parsed.data.source_type,
      kind: parsed.data.kind,
      source_url: parsed.data.source_url,
      attestation: parsed.data.attestation,
      live_enabled: liveEnabled,
    });

    // Mint a single-meeting VIEW token bound to THIS genuine create (201), for
    // THIS caller, so the submit form can show the self-serve result page. Only
    // when a session secret is configured; in open mode the published gate is
    // already open so the token is moot. Never minted on the dedup path above
    // and never derivable from the source URL.
    const secret = getConfig().sessionSecret;
    const viewToken = secret
      ? await signMeetingView(
          {
            mid: meeting.id,
            exp: Math.floor(Date.now() / 1000) + MEETING_VIEW_TTL_SECONDS,
          },
          secret
        )
      : null;

    return NextResponse.json({ ...meeting, viewToken }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
