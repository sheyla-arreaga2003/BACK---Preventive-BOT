import assert from "node:assert/strict";
import test from "node:test";
import type { RowDataPacket } from "mysql2";
import { getMotorcycleWithLatestProcessByInvoice } from "../src/services/database.service.js";

interface TestRow extends RowDataPacket {
  MOIdMoto: number;
  MOBrand: string;
  MOModel: string;
  MOYear: string | number;
  MOColor: string;
  MOPlate: string | null;
  STIdState: number | null;
  STState: string | null;
  PRFirstDate: string | null;
}

function queryReturning(rows: TestRow[]) {
  return async (_query: string, _parameters: readonly [string, string]): Promise<TestRow[]> => rows;
}

const baseRow: TestRow = {
  MOIdMoto: 15,
  MOBrand: "Honda",
  MOModel: "CB32",
  MOYear: 2026,
  MOColor: "Rojo",
  MOPlate: null,
  STIdState: 2,
  STState: "Solicitud primeras placas",
  PRFirstDate: "2026-09-24",
} as TestRow;

test("returns the motorcycle and its latest registered state", async () => {
  const result = await getMotorcycleWithLatestProcessByInvoice("A001", "000045", queryReturning([baseRow]));
  assert.deepEqual(result, {
    status: "found",
    data: {
      brand: "Honda",
      model: "CB32",
      year: 2026,
      color: "Rojo",
      plate: null,
      latestState: {
        id: 2,
        name: "Solicitud primeras placas",
        registeredDate: "2026-09-24",
      },
    },
  });
});

test("returns not_found when the invoice does not identify a motorcycle", async () => {
  const result = await getMotorcycleWithLatestProcessByInvoice("A001", "000045", queryReturning([]));
  assert.deepEqual(result, { status: "not_found" });
});

test("returns ambiguous when the invoice identifies multiple motorcycles", async () => {
  const result = await getMotorcycleWithLatestProcessByInvoice(
    "A001",
    "000045",
    queryReturning([baseRow, { ...baseRow, MOIdMoto: 16 } as TestRow]),
  );
  assert.deepEqual(result, { status: "ambiguous" });
});

test("returns null state and date when the motorcycle has no processes", async () => {
  const row = {
    ...baseRow,
    STIdState: null,
    STState: null,
    PRFirstDate: null,
  } as TestRow;
  const result = await getMotorcycleWithLatestProcessByInvoice("A001", "000045", queryReturning([row]));
  assert.equal(result.status, "found");
  if (result.status === "found") assert.equal(result.data.latestState, null);
});

test("uses the row selected by greatest process ID even when its state ID is lower", async () => {
  let capturedQuery = "";
  const result = await getMotorcycleWithLatestProcessByInvoice(
    "A001",
    "000045",
    async (query) => {
      capturedQuery = query;
      return [{
        ...baseRow,
        STIdState: 1,
        STState: "Verificación de NIT",
        PRFirstDate: "24/09/2026",
      } as TestRow];
    },
  );

  assert.match(capturedQuery, /MAX\(P\.PRIdProcess\)/);
  assert.doesNotMatch(capturedQuery, /MAX\(P\.STIdState\)/);
  assert.equal(result.status, "found");
  if (result.status === "found") assert.equal(result.data.latestState?.id, 1);
});

test("preserves leading zeros in invoice parameters", async () => {
  let capturedParameters: readonly [string, string] | null = null;
  await getMotorcycleWithLatestProcessByInvoice("  A001  ", "  000045  ", async (_query, parameters) => {
    capturedParameters = parameters;
    return [baseRow];
  });
  assert.deepEqual(capturedParameters, ["A001", "000045"]);
});

test("rejects empty invoice values", async () => {
  await assert.rejects(
    getMotorcycleWithLatestProcessByInvoice(" ", "000045", queryReturning([])),
    TypeError,
  );
  await assert.rejects(
    getMotorcycleWithLatestProcessByInvoice("A001", "", queryReturning([])),
    TypeError,
  );
});

test("does not expose internal or sensitive fields in the public result", async () => {
  const result = await getMotorcycleWithLatestProcessByInvoice("A001", "000045", queryReturning([baseRow]));
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  const serialized = JSON.stringify(result.data);
  for (const forbiddenField of [
    "MOIdMoto",
    "PRIdProcess",
    "PRObservations",
    "MOVin",
    "MOChassis",
    "MOSerieInvoice",
    "MONumberInvoice",
    "CUIdCustomer",
  ]) {
    assert.equal(serialized.includes(forbiddenField), false);
  }
});
