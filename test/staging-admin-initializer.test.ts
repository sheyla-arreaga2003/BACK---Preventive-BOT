import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "@node-rs/argon2";
import {
  AUTHORIZED_STAGING_ENVIRONMENT_ID,
  AUTHORIZED_STAGING_PROJECT_ID,
  AUTHORIZED_BACKEND_SERVICE_ID,
  runStagingAdminInitializer,
  type InitializerConnection,
  type InitializerPool,
} from "../src/services/staging-admin-initializer.service.js";

const validHashPromise = hash("unit-test-password", {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

function config(passwordHash: string, overrides: Partial<Parameters<typeof runStagingAdminInitializer>[1]> = {}) {
  return {
    enabled: true,
    nodeEnvironment: "production",
    railwayProjectId: AUTHORIZED_STAGING_PROJECT_ID,
    railwayEnvironmentId: AUTHORIZED_STAGING_ENVIRONMENT_ID,
    railwayServiceId: AUTHORIZED_BACKEND_SERVICE_ID,
    passwordHash,
    ...overrides,
  };
}

function fakePool(options: { duplicate?: boolean; admin?: boolean; failInsert?: boolean; failVerification?: boolean } = {}): InitializerPool {
  const columns = ["USId", "USName", "ROIdRol", "USLastName", "USEmail", "USPhone", "USPassword", "USFregister", "USLastLoginAt"]
    .map((COLUMN_NAME) => ({ COLUMN_NAME }));
  const connection: InitializerConnection = {
    async execute(sql: string) {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [columns];
      if (sql.includes("INFORMATION_SCHEMA.STATISTICS")) return [[{ NON_UNIQUE: 0 }]];
      if (sql.includes("SELECT ROIdRol, ROName")) return [[{ ROIdRol: 1, ROName: "Admin" }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("USEmail")) return [[{ total: options.duplicate ? 1 : 0 }]];
      if (sql.includes("COUNT(*) AS total") && sql.includes("ROIdRol")) return [[{ total: options.admin ? 1 : 0 }]];
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("SELECT USId") && sql.includes("FOR UPDATE")) return [options.duplicate || options.admin ? [{ USId: 9 }] : []];
      if (sql.includes("INSERT INTO USERS")) {
        if (options.failInsert) throw new Error("simulated insert failure");
        return [{ insertId: 10 } as never];
      }
      if (sql.includes("isArgon2id")) {
        if (options.failVerification) throw new Error("simulated verification failure");
        return [[{ USId: 10, USEmail: "sheyla.valle2003@gmail.com", ROIdRol: 1, isArgon2id: 1 }]];
      }
      return [[]];
    },
    async query() { return [[]]; },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };
  return { async getConnection() { return connection; } };
}

test("does not initialize outside the authorized Railway staging environment", async () => {
  const result = await runStagingAdminInitializer(fakePool(), config(await validHashPromise, { railwayEnvironmentId: "other" }));
  assert.deepEqual(result, { status: "skipped", reason: "outside_staging" });
});

test("rejects an invalid Argon2id hash before obtaining a connection", async () => {
  let connected = false;
  const pool: InitializerPool = { async getConnection() { connected = true; return fakePool().getConnection(); } };
  const result = await runStagingAdminInitializer(pool, config("not-a-hash"));
  assert.deepEqual(result, { status: "preflight_failed", reason: "invalid_argon2id_hash" });
  assert.equal(connected, false);
});

test("does not modify an existing administrator or duplicate email", async () => {
  const result = await runStagingAdminInitializer(fakePool({ duplicate: true }), config(await validHashPromise));
  assert.deepEqual(result, { status: "already_exists" });
});

test("creates the authorized administrator only after the guarded preflight", async () => {
  const result = await runStagingAdminInitializer(fakePool(), config(await validHashPromise));
  assert.deepEqual(result, { status: "created", userId: 10 });
});

test("reports a pre-commit failure without claiming that an administrator was created", async () => {
  const result = await runStagingAdminInitializer(fakePool({ failInsert: true }), config(await validHashPromise));
  assert.deepEqual(result, { status: "insert_failed", committed: false });
});

test("reports post-commit verification uncertainty without treating it as a clean failure", async () => {
  const result = await runStagingAdminInitializer(fakePool({ failVerification: true }), config(await validHashPromise));
  assert.deepEqual(result, { status: "verification_failed", committed: true });
});
