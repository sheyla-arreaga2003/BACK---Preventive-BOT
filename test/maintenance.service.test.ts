import assert from "node:assert/strict";
import test from "node:test";
import type {
  MaintenanceInvoiceMotorcycleRow,
  MaintenanceReadRepository,
  MaintenanceRecordRow,
  MaintenanceServiceRow,
} from "../src/services/maintenance.service.js";
import { createMaintenanceInvoiceReader } from "../src/services/maintenance.service.js";

function motorcycle(id: number): MaintenanceInvoiceMotorcycleRow {
  return { MOIdMoto: id } as MaintenanceInvoiceMotorcycleRow;
}

function maintenance(
  id: number,
  date: string,
  values: Partial<Pick<MaintenanceRecordRow, "MAMiles" | "MANextMiles" | "MANextDate">> = {},
): MaintenanceRecordRow {
  return {
    MAMaintenance: id,
    MADate: date,
    MAMiles: values.MAMiles ?? "1200",
    MANextMiles: values.MANextMiles ?? "2400",
    MANextDate: values.MANextDate ?? "2026-12-01",
  } as MaintenanceRecordRow;
}

function repository(overrides: Partial<MaintenanceReadRepository> = {}): MaintenanceReadRepository {
  return {
    async findMotorcyclesByInvoice() { return [motorcycle(10)]; },
    async countByMotorcycle() { return 0; },
    async findPageByMotorcycle() { return []; },
    async findServicesByMaintenanceIds() { return []; },
    ...overrides,
  };
}

test("returns not_found for an invoice without a motorcycle", async () => {
  const read = createMaintenanceInvoiceReader(repository({
    async findMotorcyclesByInvoice() { return []; },
  }));
  assert.deepEqual(await read("A001", "00001"), { status: "not_found" });
});

test("returns ambiguous instead of selecting the first motorcycle", async () => {
  const read = createMaintenanceInvoiceReader(repository({
    async findMotorcyclesByInvoice() { return [motorcycle(10), motorcycle(11)]; },
  }));
  assert.deepEqual(await read("A001", "00001"), { status: "ambiguous" });
});

test("returns an empty page when the motorcycle has no maintenances", async () => {
  const read = createMaintenanceInvoiceReader(repository());
  assert.deepEqual(await read("A001", "00001"), {
    status: "found",
    data: {
      maintenances: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
  });
});

test("groups multiple services under their maintenance", async () => {
  const read = createMaintenanceInvoiceReader(repository({
    async countByMotorcycle() { return 1; },
    async findPageByMotorcycle() { return [maintenance(20, "2026-09-24")]; },
    async findServicesByMaintenanceIds() {
      return [
        { MAMaintenance: 20, SEName: "Cambio de aceite", SEDescription: "Servicio registrado" } as MaintenanceServiceRow,
        { MAMaintenance: 20, SEName: "Revisión de frenos", SEDescription: "Inspección registrada" } as MaintenanceServiceRow,
      ];
    },
  }));
  const result = await read("A001", "00001");
  assert.equal(result.status, "found");
  if (result.status === "found") assert.equal(result.data.maintenances[0]?.services.length, 2);
});

test("preserves a maintenance without details", async () => {
  const read = createMaintenanceInvoiceReader(repository({
    async countByMotorcycle() { return 1; },
    async findPageByMotorcycle() { return [maintenance(20, "2026-09-24")]; },
  }));
  const result = await read("A001", "00001");
  assert.equal(result.status, "found");
  if (result.status === "found") assert.deepEqual(result.data.maintenances[0]?.services, []);
});

test("preserves null maintenance values and ignores a null service relation", async () => {
  const row = {
    MAMaintenance: 20,
    MADate: "2026-09-24",
    MAMiles: null,
    MANextMiles: null,
    MANextDate: null,
  } as MaintenanceRecordRow;
  const read = createMaintenanceInvoiceReader(repository({
    async countByMotorcycle() { return 1; },
    async findPageByMotorcycle() { return [row]; },
    async findServicesByMaintenanceIds() {
      return [{ MAMaintenance: 20, SEName: null, SEDescription: null } as MaintenanceServiceRow];
    },
  }));
  const result = await read("A001", "00001");
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.deepEqual(result.data.maintenances[0], {
      date: "2026-09-24",
      mileage: null,
      nextMileage: null,
      nextDate: null,
      services: [],
    });
  }
});

test("paginates maintenances before loading services without duplicating them", async () => {
  const allMaintenances = [
    maintenance(30, "2026-09-30"),
    maintenance(29, "2026-09-29"),
    maintenance(28, "2026-09-28"),
  ];
  let requestedServiceIds: readonly number[] = [];
  const read = createMaintenanceInvoiceReader(repository({
    async countByMotorcycle() { return allMaintenances.length; },
    async findPageByMotorcycle(_motorcycleId, pageSize, offset) {
      return allMaintenances.slice(offset, offset + pageSize);
    },
    async findServicesByMaintenanceIds(ids) {
      requestedServiceIds = ids;
      return ids.flatMap((id) => [
        { MAMaintenance: id, SEName: `Servicio ${id}`, SEDescription: "Descripción" } as MaintenanceServiceRow,
      ]);
    },
  }));
  const result = await read("A001", "00001", 2, 2);
  assert.deepEqual(requestedServiceIds, [28]);
  assert.equal(result.status, "found");
  if (result.status === "found") {
    assert.equal(result.data.maintenances.length, 1);
    assert.deepEqual(result.data.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
  }
});

test("isolates all maintenance reads to the motorcycle identified by the invoice", async () => {
  const motorcycleIds: number[] = [];
  const read = createMaintenanceInvoiceReader(repository({
    async findMotorcyclesByInvoice(serie, number) {
      assert.equal(serie, "A001");
      assert.equal(number, "00001");
      return [motorcycle(44)];
    },
    async countByMotorcycle(id) { motorcycleIds.push(id); return 1; },
    async findPageByMotorcycle(id) { motorcycleIds.push(id); return [maintenance(90, "2026-09-24")]; },
  }));
  await read(" A001 ", " 00001 ");
  assert.deepEqual(motorcycleIds, [44, 44]);
});

test("validates pagination and enforces the maximum page size", async () => {
  const read = createMaintenanceInvoiceReader(repository());
  await assert.rejects(read("A001", "00001", 0, 20), RangeError);
  await assert.rejects(read("A001", "00001", 1.5, 20), RangeError);
  await assert.rejects(read("A001", "00001", 1, 51), RangeError);
});

test("does not expose internal, invoice, client, observation, amount, or state fields", async () => {
  const read = createMaintenanceInvoiceReader(repository({
    async countByMotorcycle() { return 1; },
    async findPageByMotorcycle() { return [maintenance(20, "2026-09-24")]; },
    async findServicesByMaintenanceIds() {
      return [{ MAMaintenance: 20, SEName: "Servicio", SEDescription: "Descripción" } as MaintenanceServiceRow];
    },
  }));
  const result = await read("A001", "00001");
  const serialized = JSON.stringify(result);
  for (const field of [
    "MOIdMoto",
    "MAMaintenance",
    "USId",
    "MAObservations",
    "SEAmount",
    "SEState",
    "MOSerieInvoice",
    "MONumberInvoice",
    "CUIdCustomer",
  ]) {
    assert.equal(serialized.includes(field), false);
  }
});
