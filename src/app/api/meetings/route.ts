import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { createAndEnqueueCapture } from "@/lib/meetings/create";
import { isInternalHost, meetingHostError, parseHttpUrl } from "@/lib/net/url";
import { sourceKey } from "@/lib/net/source-key";
import { isStaffRequest } from "@/lib/owner";
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
      return NextResponse.json(
        { duplicate: true, meeting: existing },
        { status: 200 }
      );
    }

    // New submission: created published=false (pending admin review).
    const meeting = await createAndEnqueueCapture(store, {
      title: parsed.data.title,
      body_name: parsed.data.body_name,
      source_type: parsed.data.source_type,
      kind: parsed.data.kind,
      source_url: parsed.data.source_url,
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
