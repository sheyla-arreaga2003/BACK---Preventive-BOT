import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileRepository, UserProfileDetailsRow } from "../src/interfaces/profile.interface.js";
import { ProfileValidationError, createProfileService, resolveActivityPeriod } from "../src/services/profile.service.js";

function repository(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    async getProfileDetails() {
      return {
        USId: 7, USName: "Admin", USLastName: "Prueba", USEmail: "admin@example.test",
        USPhone: null, USFregister: "2026-01-10T00:00:00.000Z",
        USLastLoginAt: null, ROIdRol: 1, ROName: "Administrador",
      } as UserProfileDetailsRow;
    },
    async getActivityCounts() { return []; },
    async getActivityAvailableFrom() { return null; },
    async getActivityTotal() { return 0; },
    async getActivityPage() { return []; },
    ...overrides,
  };
}

test("el período predeterminado usa el mes vigente en Guatemala", () => {
  const result = resolveActivityPeriod(undefined, undefined, new Date("2026-11-01T04:30:00.000Z"));
  assert.equal(result.from, "2026-10-01");
  assert.equal(result.to, "2026-10-31");
  assert.equal(result.sqlFrom, "2026-10-01 06:00:00.000");
  assert.equal(result.sqlTo, "2026-11-01 06:00:00.000");
});

test("rechaza rangos invertidos, inválidos o mayores a un año", () => {
  assert.throws(() => resolveActivityPeriod("2026-10-02", "2026-10-01"), ProfileValidationError);
  assert.throws(() => resolveActivityPeriod("2026-02-30", "2026-03-01"), ProfileValidationError);
  assert.throws(() => resolveActivityPeriod("2025-01-01", "2026-02-01"), ProfileValidationError);
});

test("las estadísticas cuentan eventos del administrador y no infieren historial", async () => {
  const service = createProfileService(repository({
    async getActivityCounts() {
      return [
        { activityType: "CLIENT_CREATED", total: "2" },
        { activityType: "MAINTENANCE_CREATED", total: 3 },
      ] as never;
    },
  }));
  const result = await service.overview(7, "2026-10-01", "2026-10-31");
  assert.deepEqual(result.stats, {
    clientsRegistered: 2,
    maintenancesRegistered: 3,
    plateProcessesUpdated: 0,
  });
  assert.equal(result.historicalAttributionAvailable, false);
  assert.equal(result.activityAvailableFrom, null);
  assert.equal(result.profile.lastLoginAt, null);
});

test("la actividad se pagina y conserva solo la identidad del actor solicitado", async () => {
  const calls: number[] = [];
  const service = createProfileService(repository({
    async getActivityTotal(userId) { calls.push(userId); return 21; },
    async getActivityPage(userId) {
      calls.push(userId);
      return [{
        UAId: 9, UAEventType: "CLIENT_UPDATED", UAEntityType: "CUSTOMER",
        UAEntityId: "12", UACreatedAt: "2026-10-10T16:00:00.000Z",
      }] as never;
    },
  }));
  const result = await service.activityPage(7, 2, 10, "2026-10-01", "2026-10-31");
  assert.deepEqual(calls, [7, 7]);
  assert.equal(result.pagination.totalPages, 3);
  assert.equal(result.data[0]?.type, "CLIENT_UPDATED");
});

test("las estadísticas de dos administradores se consultan por separado", async () => {
  const requestedUsers: number[] = [];
  const service = createProfileService(repository({
    async getActivityCounts(userId) {
      requestedUsers.push(userId);
      return [{ activityType: "CLIENT_CREATED", total: userId === 7 ? 2 : 5 }] as never;
    },
    async getActivityTotal(userId) { requestedUsers.push(userId); return 0; },
    async getActivityPage() { return []; },
  }));
  const first = await service.overview(7, "2026-10-01", "2026-10-31");
  const second = await service.overview(8, "2026-10-01", "2026-10-31");
  assert.equal(first.stats.clientsRegistered, 2);
  assert.equal(second.stats.clientsRegistered, 5);
  assert.ok(requestedUsers.includes(7));
  assert.ok(requestedUsers.includes(8));
});

