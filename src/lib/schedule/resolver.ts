// Resolve a schedule's source_spec into a concrete capture URL at fire time.
// v1 ships only the fixed_url resolver. Channel/playlist resolvers (which pick
// the current live/most-recent video) can be added here behind new spec types
// without touching the scheduler or store.

import type { ScheduleSourceSpec } from "@/lib/types";

export function resolveCaptureUrl(spec: ScheduleSourceSpec): string | null {
  switch (spec.type) {
    case "fixed_url": {
      const url = spec.url?.trim();
      return url ? url : null;
    }
    default:
      return null;
  }
}
