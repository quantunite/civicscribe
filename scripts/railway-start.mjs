// Railway entrypoint: run `next start` AND an in-process tick loop in a single
// container, so one service drives both the web app and the job runner +
// schedule sweep. The loop just POSTs /api/jobs/tick on an interval (the same
// nudge scripts/worker.ts does in local dev) — no separate worker service, and
// no tsx at runtime. If the web process exits, this process exits too so
// Railway restarts the whole thing.

import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const base = `http://127.0.0.1:${port}`;
const secret = (process.env.TICK_SECRET || "").trim();
const INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS || "5000");

// How long to wait for `next start` to begin listening before we start ticking.
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || "60000");
const READY_POLL_MS = Number(process.env.READY_POLL_MS || "1000");

const next = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "start", "-p", port],
  { stdio: "inherit" }
);
next.on("exit", (code) => process.exit(code ?? 0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the local health endpoint until the server answers (any HTTP response
 * means it is listening) or the timeout elapses. Keeps the first ticks from
 * firing before `next start` is up, so we don't log a burst of connection
 * errors and the schedule sweep starts cleanly. Best-effort: if it times out we
 * start ticking anyway (the tick loop already tolerates a down server).
 */
async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, { method: "GET" });
      // Any response (even 503) proves the listener is up.
      if (res) return true;
    } catch {
      // Not listening yet; keep polling.
    }
    await sleep(READY_POLL_MS);
  }
  return false;
}

async function tick() {
  try {
    await fetch(`${base}/api/jobs/tick`, {
      method: "POST",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
  } catch {
    // Server not up yet, or a transient error — try again next interval.
  }
}

async function main() {
  await waitForReady();
  // Run an immediate first tick now that the server is (likely) up, then settle
  // into the interval.
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main();
