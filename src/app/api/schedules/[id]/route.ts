import { NextResponse } from "next/server";
import { z } from "zod";

import { getStore } from "@/lib/store";
import { requireAdmin } from "@/lib/owner";
import { isScheduleEditable } from "@/lib/schedule/editable";
import { isInternalHost, meetingHostError, parseHttpUrl } from "@/lib/net/url";
import type { ScheduleUpdate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH accepts two shapes (staff only):
//   1. Pause/resume: { enabled: boolean } — allowed at any time.
//   2. Content edit: any of title / body_name / kind / source_url /
//      next_fire_at — allowed ONLY before the schedule starts (next fire is
//      still in the future), so a mistake can be fixed without recreating it.
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  body_name: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(["civic", "course"]).optional(),
  source_url: z.string().trim().min(1).optional(),
  next_fire_at: z.string().trim().min(1).optional(),
});

const EDIT_FIELDS = [
  "title",
  "body_name",
  "kind",
  "source_url",
  "next_fire_at",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid schedule update" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const store = getStore();
  const schedule = await store.getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const update: ScheduleUpdate = {};
  const isContentEdit = EDIT_FIELDS.some(
    (f) => data[f as keyof typeof data] !== undefined
  );

  if (isContentEdit) {
    // Guard: content can only change before the schedule starts.
    if (!isScheduleEditable(schedule.next_fire_at, Date.now())) {
      return NextResponse.json(
        {
          error:
            "This schedule has already started or run, so it can no longer be edited. Pause or delete it instead.",
        },
        { status: 409 }
      );
    }

    if (data.title !== undefined) update.title = data.title;
    if (data.body_name !== undefined) update.body_name = data.body_name;
    if (data.kind !== undefined) update.kind = data.kind;

    if (data.source_url !== undefined) {
      const url = parseHttpUrl(data.source_url);
      if (!url) {
        return NextResponse.json(
          { error: "source_url must be a valid http(s) URL" },
          { status: 400 }
        );
      }
      if (schedule.source_type === "stream") {
        if (isInternalHost(url.hostname)) {
          return NextResponse.json(
            {
              error:
                "source_url must point at a public host: localhost and private addresses are not allowed",
            },
            { status: 400 }
          );
        }
      } else {
        const msg = meetingHostError(schedule.source_type, url);
        if (msg) {
          return NextResponse.json({ error: msg }, { status: 400 });
        }
      }
      update.source_spec = { type: "fixed_url", url: data.source_url };
    }

    if (data.next_fire_at !== undefined) {
      const at = new Date(data.next_fire_at);
      if (Number.isNaN(at.getTime())) {
        return NextResponse.json(
          { error: "the capture time must be a valid date/time" },
          { status: 400 }
        );
      }
      if (at.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "the capture time must be in the future" },
          { status: 400 }
        );
      }
      update.next_fire_at = at.toISOString();
    }
  }

  // Pause/resume can ride along with an edit, or stand alone (no guard).
  if (data.enabled !== undefined) update.enabled = data.enabled;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  try {
    const updated = await store.updateSchedule(id, update);
    return NextResponse.json(updated);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/schedules/:id — remove a schedule. Already-captured meetings
 *  keep their rows (schedule_id is set null by the FK). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    await getStore().deleteSchedule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
