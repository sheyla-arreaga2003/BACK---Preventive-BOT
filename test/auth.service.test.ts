import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createTokenOperations } from "../src/services/auth.service.js";

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
