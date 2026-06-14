import { NextResponse } from "next/server";
import { z } from "zod";
import { IANAZone } from "luxon";

import { getStore } from "@/lib/store";
import { requireAdmin } from "@/lib/owner";
import { firstFireAfter } from "@/lib/schedule/recurrence";
import { isInternalHost, isZoomHost, parseHttpUrl } from "@/lib/net/url";
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

const createScheduleSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    kind: z.enum(["civic", "course"]).optional(),
    source_type: z.enum(["zoom", "stream"]),
    source_url: z.string().trim().min(1, "source_url is required"),
    recurrence: recurrenceSchema,
    enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const url = parseHttpUrl(data.source_url);
    if (!url) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message: "source_url must be a valid http(s) URL",
      });
    } else {
      if (data.source_type === "zoom" && !isZoomHost(url.hostname)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_url"],
          message: "source_url must be a zoom.us meeting link",
        });
      }
      if (data.source_type === "stream" && isInternalHost(url.hostname)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_url"],
          message:
            "source_url must point at a public host: localhost and private/internal addresses are not allowed",
        });
      }
    }
    if (!IANAZone.isValidZone(data.recurrence.timezone)) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence", "timezone"],
        message: "Unknown timezone: use an IANA name like America/Chicago",
      });
    }
  });

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

/** POST /api/schedules — create a recurring capture schedule. */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const parsed = createScheduleSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json(
      { error: issues[0]?.message ?? "Invalid request", issues },
      { status: 400 }
    );
  }

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
