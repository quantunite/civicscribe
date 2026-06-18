// Railway entrypoint: run `next start` AND an in-process tick loop in a single
// container, so one service drives both the web app and the job runner +
// schedule sweep. The loop just POSTs /api/jobs/tick on an interval (the same
// nudge scripts/worker.ts does in local dev) — no separate worker service, and
// no tsx at runtime. If the web process exits, this process exits too so
// Railway restarts the whole thing.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const port = process.env.PORT || "3000";
const base = `http://127.0.0.1:${port}`;
const secret = (process.env.TICK_SECRET || "").trim();
const INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS || "5000");

// How long to wait for `next start` to begin listening before we start ticking.
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || "60000");
const READY_POLL_MS = Number(process.env.READY_POLL_MS || "1000");

/**
 * Best-effort read of THIS container's memory limit (bytes) from cgroup. Node
 * does not always infer a containerized limit, so without this V8's old-space
 * can grow past the container cap and the kernel OOM-kills the process (exit
 * 137) — Railway then restarts the whole service. Returns null when no finite
 * limit is published (e.g. local dev, or an unconstrained host).
 */
function readCgroupMemoryLimitBytes() {
  const candidates = [
    "/sys/fs/cgroup/memory.max", // cgroup v2
    "/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
  ];
  for (const file of candidates) {
    try {
      const raw = readFileSync(file, "utf8").trim();
      if (raw === "" || raw === "max") continue; // v2 sentinel for "unlimited"
      const bytes = Number(raw);
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      // v1 reports a near-2^63 sentinel when unlimited; treat anything above a
      // sane ceiling as "no real limit".
      if (bytes > 64 * 1024 * 1024 * 1024) continue;
      return bytes;
    } catch {
      // File absent (non-Linux / no cgroup): try the next candidate.
    }
  }
  return null;
}

/**
 * Pick a --max-old-space-size (MB) at ~75% of the container limit, leaving
 * headroom for Node's other arenas (C++, stack, off-heap Buffers). Returns null
 * when we cannot read a limit or it is too small to safely cap, so Node keeps
 * its own default.
 */
function chooseOldSpaceMb() {
  const limit = readCgroupMemoryLimitBytes();
  if (limit === null) return null;
  const mb = Math.floor((limit / (1024 * 1024)) * 0.75);
  if (mb < 128) return null; // too small to cap without starving the heap
  return Math.min(mb, 4096);
}

// Hand the actual web/job process (the `next start` child) a container-aware
// heap cap, unless one was already set explicitly via NODE_OPTIONS.
const childEnv = { ...process.env };
if (!/--max-old-space-size=/.test(childEnv.NODE_OPTIONS || "")) {
  const mb = chooseOldSpaceMb();
  if (mb !== null) {
    childEnv.NODE_OPTIONS =
      `${childEnv.NODE_OPTIONS ? `${childEnv.NODE_OPTIONS} ` : ""}--max-old-space-size=${mb}`;
    console.log(
      `[railway-start] V8 old-space capped at ${mb} MB (container-aware)`
    );
  }
}

const next = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "start", "-p", port],
  { stdio: "inherit", env: childEnv }
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
