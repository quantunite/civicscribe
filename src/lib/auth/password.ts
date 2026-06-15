// Server-only password hashing using node:crypto scrypt. No native deps
// (Sophos-safe), no edge usage: only the Node-runtime /api/login route and
// account creation call these. Never import from edge middleware.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEYLEN = 64;

/** Hash a plaintext password. Returns `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(plain, salt, KEYLEN);
  return `${PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verify a plaintext password against a stored `scrypt$salt$hash`.
 *  Constant-time; never throws; returns false on any malformed input. */
export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEYLEN) return false;
  const actual = await scrypt(plain, salt, KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
