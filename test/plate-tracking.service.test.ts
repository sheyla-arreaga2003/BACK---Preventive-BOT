import assert from "node:assert/strict";
import test from "node:test";
import { buildPlateTracking } from "../src/services/plate-tracking.service.js";

function processRow(id: number, state: string, date: string) {
  return { PRIdProcess: id, STState: state, PRFirstDate: date, PRDateUpdate: date };
}

test("calcula el avance solo mediante la correspondencia explícita de estados", () => {
  const tracking = buildPlateTracking([
    processRow(1, "Verificación de NIT", "2026-10-15"),
    processRow(2, "Solicitud primeras placas", "2026-10-16"),
  ] as never);

  assert.equal(tracking.currentState, "Solicitud primeras placas");
  assert.equal(tracking.percentage, 40);
  assert.equal(tracking.stages.find((stage) => stage.key === "nit-verification")?.status, "completed");
  assert.equal(tracking.stages.find((stage) => stage.key === "first-plate-request")?.status, "current");
  assert.equal(tracking.stages.find((stage) => stage.key === "iprima-payment")?.status, "pending");
});

test("un estado sin correspondencia no recibe un porcentaje inventado", () => {
  const tracking = buildPlateTracking([
    processRow(8, "Estado futuro sin regla", "2026-10-16"),
  ] as never);

  assert.equal(tracking.currentState, "Estado futuro sin regla");
  assert.equal(tracking.percentage, null);
  assert.equal(tracking.stages.some((stage) => stage.status === "current"), false);
});

test("reconoce todas las etapas persistentes sin convertir el inicio visual en catálogo", () => {
  const tracking = buildPlateTracking([
    processRow(1, "Verificación de NIT", "2026-10-01"),
    processRow(2, "Solicitud primeras placas", "2026-10-02"),
    processRow(3, "Pago IPRIMA registrado", "2026-10-03"),
    processRow(4, "Documentos presentados y contraseña de pago recibida", "2026-10-04"),
    processRow(5, "Pago final registrado y gestión finalizada", "2026-10-05"),
    processRow(6, "Placas recibidas en Mototec", "2026-10-06"),
  ] as never);

  assert.equal(tracking.currentState, "Placas recibidas en Mototec");
  assert.equal(tracking.percentage, 100);
  assert.equal(tracking.stages[0]?.label, "Inicio del trámite");
  assert.equal(tracking.stages[0]?.status, "completed");
  assert.equal(tracking.stages.filter((stage) => stage.key !== "start").length, 6);
  assert.equal(tracking.stages.at(-1)?.status, "current");
});
