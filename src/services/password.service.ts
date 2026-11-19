import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ARGON2ID_PREFIX = "$argon2id$";
const ARGON2_OPTIONS = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

function legacySha256(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (storedHash.startsWith(ARGON2ID_PREFIX)) {
    try {
      return { valid: await verify(storedHash, password), needsUpgrade: false };
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  if (!LEGACY_SHA256_PATTERN.test(storedHash)) {
    return { valid: false, needsUpgrade: false };
  }

  const valid = constantTimeTextEqual(storedHash.toLowerCase(), legacySha256(password));
  return { valid, needsUpgrade: valid };
}

export function isArgon2idHash(value: string): boolean {
  return value.startsWith(ARGON2ID_PREFIX);
}
