import assert from "node:assert/strict";
import test from "node:test";
import { createAdminSessionManager } from "../src/services/auth.service.js";

class SessionRedis {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  async get(key: string) { return this.strings.get(key) ?? null; }
  async del(key: string) { return this.strings.delete(key) ? 1 : 0; }
  async sRem(key: string, member: string) { return this.sets.get(key)?.delete(member) ? 1 : 0; }
  async sMembers(key: string) { return [...(this.sets.get(key) ?? [])]; }
}

test("lista sesiones simultáneas sin exponer el identificador interno", async () => {
  const redis = new SessionRedis();
  redis.sets.set("user-sessions:7", new Set(["sid-current", "sid-other"]));
  redis.strings.set("session:sid-current", JSON.stringify({
    userId: 7, email: "admin@example.test", publicId: "public-current",
    createdAt: "2026-10-28T10:00:00.000Z", lastActivityAt: "2026-10-28T10:01:00.000Z",
    userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit Safari/605.1.15",
  }));
  redis.strings.set("session:sid-other", JSON.stringify({
    userId: 7, email: "admin@example.test", publicId: "public-other",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
  }));
  const manager = createAdminSessionManager(redis, "test-secret");
  const sessions = await manager.list(7, "sid-current");
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((session) => session.current)?.operatingSystem, "macOS");
  assert.ok(sessions.every((session) => !JSON.stringify(session).includes("sid-")));
});

test("revoca otra sesión propia y conserva la actual", async () => {
  const redis = new SessionRedis();
  redis.sets.set("user-sessions:7", new Set(["current", "other"]));
  redis.strings.set("session:current", JSON.stringify({ userId: 7, email: "a@test", publicId: "current-ref" }));
  redis.strings.set("session:other", JSON.stringify({ userId: 7, email: "a@test", publicId: "other-ref" }));
  const manager = createAdminSessionManager(redis, "test-secret");
  assert.equal(await manager.revoke(7, "current", "other-ref"), "deleted");
  assert.ok(redis.strings.has("session:current"));
  assert.ok(!redis.strings.has("session:other"));
  assert.equal(await manager.revoke(7, "current", "current-ref"), "current");
});

test("una sesión antigua sin metadatos sigue siendo válida y recibe una referencia opaca", async () => {
  const redis = new SessionRedis();
  redis.strings.set("session:legacy", JSON.stringify({ userId: 7, email: "a@test" }));
  const manager = createAdminSessionManager(redis, "test-secret");
  const sessions = await manager.list(7, "legacy");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.current, true);
  assert.equal(sessions[0]?.createdAt, null);
  assert.notEqual(sessions[0]?.reference, "legacy");
});

test("no lista ni revoca una sesión perteneciente a otro usuario", async () => {
  const redis = new SessionRedis();
  redis.sets.set("user-sessions:7", new Set(["own", "foreign"]));
  redis.strings.set("session:own", JSON.stringify({ userId: 7, email: "a@test", publicId: "own-ref" }));
  redis.strings.set("session:foreign", JSON.stringify({ userId: 8, email: "b@test", publicId: "foreign-ref" }));
  const manager = createAdminSessionManager(redis, "test-secret");
  assert.deepEqual((await manager.list(7, "own")).map((session) => session.reference), ["own-ref"]);
  assert.equal(await manager.revoke(7, "own", "foreign-ref"), "not_found");
  assert.ok(redis.strings.has("session:foreign"));
});
