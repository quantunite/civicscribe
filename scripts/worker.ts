// Dev worker: POSTs <APP_BASE_URL>/api/jobs/tick every 5 seconds so queued
// jobs get processed while `npm run dev` is up. Run with: npm run worker
//
// Deliberately dependency-free (global fetch + node builtins only, no "@/"
// alias) so it runs under tsx/ts-node without touching the Next.js build.

const BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  ""
);
const TICK_URL = `${BASE_URL}/api/jobs/tick`;
const INTERVAL_MS = 5_000;

// When the app is deployed with CRON_SECRET set, the tick endpoint requires it.
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
const TICK_HEADERS: Record<string, string> = CRON_SECRET
  ? { authorization: `Bearer ${CRON_SECRET}` }
  : {};

interface TickJob {
  id: string;
  type: string;
  meeting_id: string;
  status: string;
}

interface TickResult {
  processed: boolean;
  job?: TickJob;
  error?: string;
}

let stopped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
// Track what we last logged so quiet periods don't spam the terminal:
// "idle" and "unreachable" are each logged once per streak.
let lastState: "busy" | "idle" | "offline" = "busy";

async function tick(): Promise<void> {
  let result: TickResult;
  try {
    const res = await fetch(TICK_URL, { method: "POST", headers: TICK_HEADERS });
    if (!res.ok) {
      if (lastState !== "offline") {
        console.log(`[worker] tick returned HTTP ${res.status} — retrying`);
        lastState = "offline";
      }
      return;
    }
    result = (await res.json()) as TickResult;
  } catch {
    if (lastState !== "offline") {
      console.log(
        `[worker] cannot reach ${TICK_URL} (is the dev server up?) — retrying`
      );
      lastState = "offline";
    }
    return;
  }

  if (result.processed && result.job) {
    const shortId = result.job.id.slice(0, 4);
    const outcome = result.error ? `FAIL: ${result.error}` : "ok";
    console.log(`[worker] ${result.job.type} ${shortId} ${outcome}`);
    lastState = "busy";
  } else if (result.error) {
    console.log(`[worker] runner error: ${result.error}`);
    lastState = "busy";
  } else if (lastState !== "idle") {
    console.log("[worker] idle");
    lastState = "idle";
  }
}

function scheduleNext(): void {
  if (stopped) {
    return;
  }
  timer = setTimeout(() => {
    void tick().finally(scheduleNext);
  }, INTERVAL_MS);
}

function shutdown(): void {
  if (stopped) {
    return;
  }
  stopped = true;
  if (timer) {
    clearTimeout(timer);
  }
  console.log("\n[worker] stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(
  `[worker] polling ${TICK_URL} every ${INTERVAL_MS / 1000}s (Ctrl+C to stop)`
);
void tick().finally(scheduleNext);
