import type { MeetingStatus } from "@/lib/types";

interface StatusConfig {
  label: string;
  /** Statuses the pipeline is still working through get a subtle pulse. */
  processing: boolean;
  badgeClass: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<MeetingStatus, StatusConfig> = {
  pending: {
    label: "Queued",
    processing: true,
    badgeClass: "bg-slate-200 text-slate-900",
    dotClass: "bg-slate-600",
  },
  capturing: {
    label: "Capturing audio",
    processing: true,
    badgeClass: "bg-amber-100 text-amber-900",
    dotClass: "bg-amber-600",
  },
  transcribing: {
    label: "Transcribing",
    processing: true,
    badgeClass: "bg-sky-100 text-sky-900",
    dotClass: "bg-sky-600",
  },
  summarizing: {
    label: "Summarizing",
    processing: true,
    badgeClass: "bg-violet-100 text-violet-900",
    dotClass: "bg-violet-600",
  },
  complete: {
    label: "Complete",
    processing: false,
    badgeClass: "bg-emerald-100 text-emerald-900",
    dotClass: "bg-emerald-600",
  },
  failed: {
    label: "Failed",
    processing: false,
    badgeClass: "bg-red-100 text-red-900",
    dotClass: "bg-red-600",
  },
};

/** Returns true for statuses the dashboard should keep polling on. */
export function isProcessingStatus(status: MeetingStatus): boolean {
  return STATUS_CONFIG[status].processing;
}

export default function StatusBadge({ status }: { status: MeetingStatus }) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${config.badgeClass}`}
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${config.dotClass} ${
          config.processing ? "animate-pulse-soft" : ""
        }`}
      />
      {config.label}
      {config.processing && <span className="sr-only">(in progress)</span>}
    </span>
  );
}
