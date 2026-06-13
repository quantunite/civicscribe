import { NextResponse } from "next/server";
import { z } from "zod";

import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ enabled: z.boolean() });

/** PATCH /api/schedules/:id — pause/resume a schedule (toggle enabled). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { error: "Body must be { enabled: boolean }" },
      { status: 400 }
    );
  }
  try {
    const store = getStore();
    if (!(await store.getSchedule(id))) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    const updated = await store.updateSchedule(id, {
      enabled: parsed.data.enabled,
    });
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
