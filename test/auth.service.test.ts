import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { UserRow } from "../src/interfaces/database.interface.js";
import { createLoginValidator, createTokenOperations } from "../src/services/auth.service.js";
import { isArgon2idHash, verifyPassword } from "../src/services/password.service.js";

const secret = "test-secret-with-sufficient-length";
const sessionId = "98cdd953-e2e6-4429-8970-e5799c249fcc";

class MemoryRedis {
  readonly sessions = new Map<string, string>();
  shouldFail = false;

  async get(key: string): Promise<string | null> {
    if (this.shouldFail) throw new Error("redis unavailable");
    return this.sessions.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    if (this.shouldFail) throw new Error("redis unavailable");
    this.sessions.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    if (this.shouldFail) throw new Error("redis unavailable");
    return this.sessions.delete(key) ? 1 : 0;
  }
}

function signToken(userId: number, expiresIn: number = 60): string {
  return jwt.sign({ sub: userId, sid: sessionId }, secret, { expiresIn });
}

test("accepts a valid token with a matching active session", async () => {
  const redis = new MemoryRedis();
  redis.sessions.set(`session:${sessionId}`, JSON.stringify({ userId: "7", email: "user@example.com" }));
  const operations = createTokenOperations({ jwtSecret: secret, redis });
  const result = await operations.validateToken(signToken(7));
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.userId, 7);
});

test("rejects expired and malformed tokens", async () => {
  const operations = createTokenOperations({ jwtSecret: secret, redis: new MemoryRedis() });
  assert.deepEqual(await operations.validateToken(signToken(7, -1)), { success: false, reason: "invalid_token" });
  assert.deepEqual(await operations.validateToken("invalid-token"), { success: false, reason: "invalid_token" });
});

test("rejects a token when its session does not exist", async () => {
  const operations = createTokenOperations({ jwtSecret: secret, redis: new MemoryRedis() });
  assert.deepEqual(await operations.validateToken(signToken(7)), { success: false, reason: "invalid_session" });
});

test("rejects a token immediately after logout", async () => {
  const redis = new MemoryRedis();
  redis.sessions.set(`session:${sessionId}`, JSON.stringify({ userId: 7, email: "user@example.com" }));
  const operations = createTokenOperations({ jwtSecret: secret, redis });
  assert.equal((await operations.validateToken(signToken(7))).success, true);
  assert.deepEqual(await operations.logout(sessionId), { success: true });
  assert.deepEqual(await operations.validateToken(signToken(7)), { success: false, reason: "invalid_session" });
});

test("rejects a mismatch between JWT subject and Redis user", async () => {
  const redis = new MemoryRedis();
  redis.sessions.set(`session:${sessionId}`, JSON.stringify({ userId: 8, email: "user@example.com" }));
  const operations = createTokenOperations({ jwtSecret: secret, redis });
  assert.deepEqual(await operations.validateToken(signToken(7)), { success: false, reason: "invalid_session" });
});

test("reports Redis failures without accepting the token", async () => {
  const redis = new MemoryRedis();
  redis.shouldFail = true;
  const operations = createTokenOperations({ jwtSecret: secret, redis });
  assert.deepEqual(await operations.validateToken(signToken(7)), { success: false, reason: "session_store_unavailable" });
});

class LoginRedis {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  async set(key: string, value: string) { this.strings.set(key, value); return "OK"; }
  async del(key: string) { return this.strings.delete(key) ? 1 : 0; }
  async sAdd(key: string, member: string) {
    const values = this.sets.get(key) ?? new Set<string>();
    values.add(member);
    this.sets.set(key, values);
    return 1;
  }
  async sRem(key: string, member: string) { return this.sets.get(key)?.delete(member) ? 1 : 0; }
  async expire() { return 1; }
}

function loginUser(): UserRow {
  return {
    USId: 7,
    USName: "Admin",
    USLastName: "Prueba",
    USEmail: "admin@example.test",
    USPhone: null,
    USPassword: crypto.createHash("sha256").update("correcta-segura").digest("hex"),
    ROIdRol: 1,
  } as UserRow;
}

test("registra último acceso solamente después de un login exitoso", async () => {
  const redis = new LoginRedis();
  const updated: number[] = [];
  let upgradedHash = "";
  let uuid = 0;
  const validate = createLoginValidator({
    async getUsersByEmail() { return [loginUser()]; },
    async updatePasswordHash(_userId, passwordHash) { upgradedHash = passwordHash; },
    async updateLastLogin(userId) { updated.push(userId); },
    redis,
    jwtSecret: secret,
    randomUUID: () => uuid++ === 0 ? sessionId : "f9a629a8-871f-4de4-992a-09ea7c5b00c3",
    now: () => new Date("2026-10-29T14:00:00.000Z"),
  });
  const failed = await validate("admin@example.test", "incorrecta");
  assert.equal(failed.success, false);
  assert.deepEqual(updated, []);
  const success = await validate("admin@example.test", "correcta-segura", "Mozilla/5.0");
  assert.equal(success.success, true);
  assert.deepEqual(updated, [7]);
  assert.equal(isArgon2idHash(upgradedHash), true);
  assert.equal((await verifyPassword(upgradedHash, "correcta-segura")).valid, true);
});

test("si falla guardar el último acceso invalida la sesión recién creada", async () => {
  const redis = new LoginRedis();
  const validate = createLoginValidator({
    async getUsersByEmail() { return [loginUser()]; },
    async updatePasswordHash() {},
    async updateLastLogin() { throw new Error("database unavailable"); },
    redis,
    jwtSecret: secret,
    randomUUID: () => sessionId,
    now: () => new Date("2026-10-29T14:00:00.000Z"),
  });
  assert.deepEqual(await validate("admin@example.test", "correcta-segura"), {
    success: false,
    reason: "database_unavailable",
  });
  assert.equal(redis.strings.size, 0);
});
