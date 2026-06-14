// Tiny structured JSON logger. Each call emits ONE JSON line:
//   {"ts":"<iso>","level":"info|warn|error","msg":"...", ...fields}
// info -> console.log; warn/error -> console.error (so logs and problems split
// cleanly across stdout/stderr in Railway).
//
// SECRETS: this logger must NEVER serialize secrets or the AppConfig. Two
// safeguards: (1) callers pass only plain fields, never the config object;
// (2) defense in depth, any field whose key matches a secret-ish pattern is
// replaced with "[redacted]" before serialization. Reserved keys (ts/level/msg)
// cannot be overridden by a caller field.

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

// Field keys that must never have their value serialized. Matched
// case-insensitively as a substring, so "anthropicApiKey", "OWNER_SECRET",
// "authorization", "access_token", "password" are all caught.
const SECRET_KEY_PATTERN = /(secret|token|password|authorization|apikey|api_key|key)/i;

const REDACTED = "[redacted]";

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : v;
  }
  return out;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  // Reserved keys win: spread caller fields first, then overwrite with the
  // canonical ts/level/msg so a stray field can't spoof them.
  const record = {
    ...(fields ? redact(fields) : {}),
    ts: new Date().toISOString(),
    level,
    msg,
  };
  const line = JSON.stringify(record);
  if (level === "info") {
    console.log(line);
  } else {
    console.error(line);
  }
}

export const log = {
  info(msg: string, fields?: LogFields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    emit("error", msg, fields);
  },
};
