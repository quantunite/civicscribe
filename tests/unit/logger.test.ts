// Structured JSON logger (src/lib/logger.ts).
//
// Each call emits exactly one JSON line carrying ts, level, msg and any extra
// fields. error/warn go to console.error; info goes to console.log. The logger
// must never leak secrets: any field whose key looks secret-ish (key, secret,
// token, password, authorization) is redacted rather than serialized.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/logger";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The single JSON object emitted by the most recent console.log call. */
function lastInfo(): Record<string, unknown> {
  const calls = logSpy.mock.calls;
  return JSON.parse(calls[calls.length - 1][0] as string);
}

/** The single JSON object emitted by the most recent console.error call. */
function lastError(): Record<string, unknown> {
  const calls = errorSpy.mock.calls;
  return JSON.parse(calls[calls.length - 1][0] as string);
}

describe("log.info", () => {
  it("emits one JSON line with ts, level, msg", () => {
    log.info("tick processed");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    // One line: no embedded newline.
    expect(line).not.toContain("\n");
    const obj = JSON.parse(line);
    expect(obj.level).toBe("info");
    expect(obj.msg).toBe("tick processed");
    expect(typeof obj.ts).toBe("string");
    // ts is an ISO-8601 timestamp.
    expect(Number.isNaN(Date.parse(obj.ts as string))).toBe(false);
  });

  it("merges extra fields into the JSON line", () => {
    log.info("job done", { jobId: "j1", type: "summarize", count: 3 });
    const obj = lastInfo();
    expect(obj).toMatchObject({
      level: "info",
      msg: "job done",
      jobId: "j1",
      type: "summarize",
      count: 3,
    });
  });
});

describe("log.warn / log.error", () => {
  it("warn goes to console.error with level warn", () => {
    log.warn("schedule sweep slow", { ms: 1200 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const obj = lastError();
    expect(obj.level).toBe("warn");
    expect(obj.msg).toBe("schedule sweep slow");
    expect(obj.ms).toBe(1200);
  });

  it("error goes to console.error with level error", () => {
    log.error("job failed", { jobId: "j2", error: "boom" });
    const obj = lastError();
    expect(obj.level).toBe("error");
    expect(obj.msg).toBe("job failed");
    expect(obj.error).toBe("boom");
  });
});

describe("secret redaction", () => {
  it("redacts secret-ish field keys instead of serializing their values", () => {
    log.info("oops", {
      anthropicApiKey: "sk-ant-super-secret",
      ownerSecret: "top-secret",
      authorization: "Bearer abc123",
      password: "hunter2",
      safe: "kept",
    });
    const line = logSpy.mock.calls[0][0] as string;
    // None of the secret values appear anywhere in the serialized line.
    expect(line).not.toContain("sk-ant-super-secret");
    expect(line).not.toContain("top-secret");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("hunter2");

    const obj = JSON.parse(line);
    expect(obj.anthropicApiKey).toBe("[redacted]");
    expect(obj.ownerSecret).toBe("[redacted]");
    expect(obj.authorization).toBe("[redacted]");
    expect(obj.password).toBe("[redacted]");
    // Non-secret fields pass through untouched.
    expect(obj.safe).toBe("kept");
  });

  it("does not let a field override the reserved ts/level/msg keys", () => {
    log.info("real message", { msg: "spoofed", level: "debug", ts: "fake" });
    const obj = lastInfo();
    expect(obj.msg).toBe("real message");
    expect(obj.level).toBe("info");
    expect(obj.ts).not.toBe("fake");
  });
});
