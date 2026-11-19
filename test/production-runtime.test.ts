import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import request from "supertest";
import { createHealthRouter } from "../src/routes/health.routes.js";
import { checkReadiness } from "../src/services/health.service.js";
import { gracefulShutdown } from "../src/services/lifecycle.service.js";
import { startBackgroundWorkers, startOptionalBackgroundWorkers } from "../src/services/worker-runner.service.js";
import type { DistributedLockRunner } from "../src/services/distributed-lock.service.js";

const testLockRunner: DistributedLockRunner = {
  async run(name, task) {
    await task({ name, ownerId: "test-owner", assertOwnership: async () => undefined });
    return "executed";
  },
};

test("readiness is successful only when MySQL and Redis respond", async () => {
  const ready = await checkReadiness({
    mysql: { query: async () => [] },
    redis: { isOpen: true, ping: async () => "PONG" },
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.checks, { mysql: "up", redis: "up" });

  const unavailable = await checkReadiness({
    mysql: { query: async () => { throw new Error("unavailable"); } },
    redis: { isOpen: false, ping: async () => "PONG" },
  });
  assert.equal(unavailable.ready, false);
  assert.deepEqual(unavailable.checks, { mysql: "down", redis: "down" });
});

test("health routes return 200 for live and 503 when dependencies are not ready", async () => {
  const app = express();
  app.use("/health", createHealthRouter(async () => ({
    ready: false,
    status: "not_ready",
    checks: { mysql: "down", redis: "up" },
  })));
  assert.equal((await request(app).get("/health/live")).status, 200);
  const readyResponse = await request(app).get("/health/ready");
  assert.equal(readyResponse.status, 503);
  assert.equal(readyResponse.body.ready, false);
});

test("background workers run controlled tasks and stop without overlapping resources", async () => {
  let reminders = 0;
  let appointments = 0;
  let notifications = 0;
  const controller = startBackgroundWorkers(5, {
    processReminders: async () => { reminders += 1; },
    closeExpiredAppointments: async () => { appointments += 1; return 0; },
    generateNotifications: async () => { notifications += 1; },
  }, testLockRunner);
  await new Promise((resolve) => setTimeout(resolve, 18));
  await controller.stop();
  assert.ok(reminders > 0);
  assert.ok(appointments > 0);
  assert.equal(appointments, notifications);
});

test("an occupied distributed lock skips the cycle without running worker dependencies", async () => {
  let executions = 0;
  const occupiedLockRunner: DistributedLockRunner = {
    async run() { return "skipped"; },
  };
  const controller = startBackgroundWorkers(5, {
    processReminders: async () => { executions += 1; },
    closeExpiredAppointments: async () => { executions += 1; return 0; },
    generateNotifications: async () => { executions += 1; },
  }, occupiedLockRunner);
  await new Promise((resolve) => setTimeout(resolve, 18));
  await controller.stop();
  assert.equal(executions, 0);
});

test("disabled background workers do not schedule or execute tasks", async () => {
  let executions = 0;
  const controller = startOptionalBackgroundWorkers(false, 5, {
    processReminders: async () => { executions += 1; },
    closeExpiredAppointments: async () => { executions += 1; return 0; },
    generateNotifications: async () => { executions += 1; },
  });
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(controller, undefined);
  assert.equal(executions, 0);
});

test("graceful shutdown closes HTTP, workers, MySQL, and Redis", async () => {
  const events: string[] = [];
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await gracefulShutdown({
    server,
    worker: { stop: async () => { events.push("worker"); } },
    closeMysql: async () => { events.push("mysql"); },
    closeRedis: async () => { events.push("redis"); },
    timeoutMs: 1_000,
  });
  assert.deepEqual(events, ["worker", "mysql", "redis"]);
  assert.equal(server.listening, false);
});
