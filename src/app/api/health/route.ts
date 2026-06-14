// GET /api/health — liveness/readiness probe for the Railway healthcheck and
// uptime monitors. Does a cheap store read to confirm the data layer is
// reachable, then reports { ok, store, mock }.
//
// 200 when the probe read succeeds; 503 when it throws (store/DB unreachable),
// so the platform can surface an unhealthy instance. The error detail is logged
// but NOT returned, to avoid leaking internals to the public.

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const mock = getConfig().mockMode;
  try {
    // Cheap read: listing schedules touches the store without scanning the
    // (potentially large) meeting set.
    await getStore().listSchedules();
    return NextResponse.json({ ok: true, store: "ok", mock }, { status: 200 });
  } catch (err) {
    log.error("health: store probe failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, store: "error", mock },
      { status: 503 }
    );
  }
}
