import assert from "node:assert/strict";
import test from "node:test";
import { getMotorcycleFleetSummary } from "../src/services/chatbot-read.service.js";
import { hasRegisteredPlate } from "../src/services/motorcycle-plate-status.service.js";

test("calcula totales sin joins y usa la definición unificada de placa ausente", async () => {
  let sql = "";
  const result = await getMotorcycleFleetSummary(async (query) => {
    sql = query;
    return [{ total: 4, withoutPlate: 1 }];
  });
  assert.deepEqual(result, { total: 4, withPlate: 3, withoutPlate: 1 });
  assert.match(sql, /COUNT\(\*\) AS total/i);
  assert.match(sql, /MOPlate IS NULL OR TRIM\(MOPlate\) = ''/i);
  assert.doesNotMatch(sql, /JOIN/i);
});

test("resumen y listado de pendientes comparten NULL, vacío y espacios sin duplicaciones", () => {
  const fixtures = [
    { id: 1, plate: null },
    { id: 2, plate: "" },
    { id: 3, plate: "   " },
    { id: 4, plate: "M001ABC" },
    { id: 5, plate: "M002ABC" },
  ];
  const pending = fixtures.filter((item) => !hasRegisteredPlate(item.plate));
  const withPlate = fixtures.filter((item) => hasRegisteredPlate(item.plate));
  assert.equal(fixtures.length, withPlate.length + pending.length);
  assert.deepEqual(pending.map((item) => item.id), [1, 2, 3]);
  assert.equal(new Set(pending.map((item) => item.id)).size, pending.length);
});

test("placa registrada describe presencia del dato, no entrega al cliente", () => {
  assert.equal(hasRegisteredPlate("M001ABC"), true);
  assert.equal(hasRegisteredPlate("  "), false);
  assert.doesNotMatch("Con placa registrada", /entregad/i);
});

test("devuelve ceros cuando no existen motocicletas", async () => {
  assert.deepEqual(
    await getMotorcycleFleetSummary(async () => [{ total: 0, withoutPlate: 0 }]),
    { total: 0, withPlate: 0, withoutPlate: 0 },
  );
});

test("propaga un error de base de datos y no lo convierte en ceros", async () => {
  await assert.rejects(
    getMotorcycleFleetSummary(async () => { throw new Error("simulated database failure"); }),
    /simulated database failure/,
  );
});
