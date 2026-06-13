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

const next = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "start", "-p", port],
  { stdio: "inherit" }
);
next.on("exit", (code) => process.exit(code ?? 0));

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

setInterval(tick, INTERVAL_MS);
