import { NextResponse } from "next/server";
import { z } from "zod";
import { IANAZone } from "luxon";

import { getStore } from "@/lib/store";
import { requireAdmin } from "@/lib/owner";
import { enforceSubmitGuardrails } from "@/lib/guardrails";
import { firstFireAfter } from "@/lib/schedule/recurrence";
import { isInternalHost, meetingHostError, parseHttpUrl } from "@/lib/net/url";
import type { Recurrence } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const recurrenceSchema = z.discriminatedUnion("freq", [
  z.object({
    freq: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(timeRegex, "time must be HH:mm (24-hour)"),
    timezone: z.string().min(1),
    interval: z.number().int().min(1).max(52).optional(),
  }),
  z.object({
    freq: z.literal("monthly"),
    weekday: z.number().int().min(0).max(6),
    nth: z
      .number()
      .int()
      .refine((n) => (n >= 1 && n <= 5) || n === -1, "nth must be 1-5 or -1 (last)"),
    time: z.string().regex(timeRegex, "time must be HH:mm (24-hour)"),
    timezone: z.string().min(1),
  }),
]);

/** Validate a source_url the same way the public generate path does: it must be
 *  a real http(s) URL, a zoom.us host for zoom, and a public (non-internal) host
 *  for stream. Adds a zod issue on the source_url path when it fails. */
function refineSourceUrl(
  data: { source_type: "zoom" | "teams" | "meet" | "stream"; source_url: string },
  ctx: z.RefinementCtx
): void {
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
}

const createScheduleSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    kind: z.enum(["civic", "course"]).optional(),
    source_type: z.enum(["zoom", "teams", "meet", "stream"]),
    source_url: z.string().trim().min(1, "source_url is required"),
    recurrence: recurrenceSchema,
    enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    refineSourceUrl(data, ctx);
    if (!IANAZone.isValidZone(data.recurrence.timezone)) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence", "timezone"],
        message: "Unknown timezone: use an IANA name like America/Chicago",
      });
    }
  });

/** One-off capture: a single future instant, no recurrence. The chosen time
 *  arrives as next_fire_at or scheduled_at (alias); it must be in the future. */
const oneOffScheduleSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    kind: z.enum(["civic", "course"]).optional(),
    source_type: z.enum(["zoom", "teams", "meet", "stream"]),
    source_url: z.string().trim().min(1, "source_url is required"),
    next_fire_at: z.string().trim().min(1).optional(),
    scheduled_at: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    refineSourceUrl(data, ctx);
    const when = data.next_fire_at ?? data.scheduled_at;
    if (!when) {
      ctx.addIssue({
        code: "custom",
        path: ["next_fire_at"],
        message: "a capture time is required for a one-off",
      });
      return;
    }
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["next_fire_at"],
        message: "the capture time must be a valid date/time",
      });
      return;
    }
    if (at.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["next_fire_at"],
        message: "the capture time must be in the future",
      });
    }
  });

function jsonIssues(error: z.ZodError): NextResponse {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return NextResponse.json(
    { error: issues[0]?.message ?? "Invalid request", issues },
    { status: 400 }
  );
}

/** GET /api/schedules — all schedules, newest first. */
export async function GET() {
  try {
    return NextResponse.json(await getStore().listSchedules());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list schedules";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/schedules: create a capture schedule.
 *
 * Discriminated on `mode`:
 *   - "one-off": a single future capture. PUBLIC + rate-limited
 *     (enforceSubmitGuardrails runs FIRST, before any DB write, so a capped
 *     caller never reaches a paid path). recurrence MUST be absent.
 *   - "recurring": an open-ended repeating expense. ADMIN ONLY (requireAdmin
 *     runs FIRST; a non-admin gets 401). recurrence is REQUIRED.
 *
 * Backward compatible: a missing `mode` with `recurrence` present is treated as
 * recurring (the original contract).
 *
 * COST SAFETY is the #1 invariant: one-off is never admin-exempt past the
 * guardrails, and recurring is never reachable by a non-admin.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const raw = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const mode = raw.mode;
  const hasRecurrence = raw.recurrence != null;

  // Route to one-off vs recurring. A missing mode defaults to recurring when a
  // recurrence is present (legacy callers); otherwise it is an invalid request.
  const isOneOff = mode === "one-off";
  const isRecurring =
    mode === "recurring" || (mode === undefined && hasRecurrence);

  if (isOneOff) {
    if (hasRecurrence) {
      return NextResponse.json(
        { error: "recurrence must be absent for a one-off" },
        { status: 400 }
      );
    }
    // PUBLIC + rate-limited. Admin-exempt (and a no-op when OWNER_SECRET is
    // unset), but ALWAYS enforced before any work for a public caller.
    const limited = enforceSubmitGuardrails(request);
    if (limited) return limited;

    const parsed = oneOffScheduleSchema.safeParse(body);
    if (!parsed.success) return jsonIssues(parsed.error);

    try {
      const data = parsed.data;
      const next_fire_at = new Date(
        data.next_fire_at ?? data.scheduled_at ?? ""
      ).toISOString();
      const schedule = await getStore().createSchedule({
        title: data.title,
        body_name: data.body_name,
        kind: data.kind,
        source_type: data.source_type,
        source_spec: { type: "fixed_url", url: data.source_url },
        recurrence: null,
        one_off: true,
        next_fire_at,
      });
      return NextResponse.json(schedule, { status: 201 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create schedule";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (isRecurring) {
    // ADMIN ONLY: a non-admin recurring POST is refused before any work.
    const denied = requireAdmin(request);
    if (denied) return denied;

    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) return jsonIssues(parsed.error);

    try {
      const data = parsed.data;
      const recurrence = data.recurrence as Recurrence;
      const next_fire_at = firstFireAfter(recurrence, new Date()).toISOString();
      const schedule = await getStore().createSchedule({
        title: data.title,
        body_name: data.body_name,
        kind: data.kind,
        source_type: data.source_type,
        source_spec: { type: "fixed_url", url: data.source_url },
        recurrence,
        one_off: false,
        enabled: data.enabled,
        next_fire_at,
      });
      return NextResponse.json(schedule, { status: 201 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create schedule";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      error:
        'Provide mode "one-off" with a future capture time, or mode "recurring" with a recurrence.',
    },
    { status: 400 }
  );
}
