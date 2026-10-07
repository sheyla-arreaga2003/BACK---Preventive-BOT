import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_CAPABILITIES,
  capabilitiesMessage,
  resolveGroundedDateRange,
  validateIntentProposal,
  type ChatAudience,
  type CapabilityId,
  type IntentProposal,
  createModelIntentSelector,
  enforceClassificationPolicy,
} from "../src/services/chatbot-capabilities.service.js";
import type { ChatModelGateway } from "../src/services/chatbot-model.service.js";

interface EvaluationCase {
  name: string;
  message: string;
  audience: ChatAudience;
  hasMotorcycle: boolean;
  simulatedProposal: IntentProposal;
  expectedStatus: "valid" | "clarification" | "unsupported";
  expectedCapability: CapabilityId | null;
  expectedTool: string | null;
  expectedParameters?: Record<string, string | number>;
}

const cases: EvaluationCase[] = [
  {
    name: "fallo observado: NIT no soportado", message: "Buscá la moto del nit 123", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "unsupported", capabilityId: null }, expectedStatus: "unsupported", expectedCapability: null, expectedTool: null,
  },
  {
    name: "fallo observado: conteo de clientes", message: "¿Cuántos clietnes hay?", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "unsupported", capabilityId: null }, expectedStatus: "unsupported", expectedCapability: null, expectedTool: null,
  },
  {
    name: "paráfrasis con error ortográfico", message: "enseñame las motod sin plaka", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "compatible", capabilityId: "pending_plates" }, expectedStatus: "valid", expectedCapability: "pending_plates", expectedTool: "get_pending_plates",
  },
  {
    name: "pregunta ambigua", message: "¿Cómo va todo?", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "ambiguous", capabilityId: null }, expectedStatus: "clarification", expectedCapability: null, expectedTool: null,
  },
  {
    name: "cambio de tema sin reciclar fechas", message: "Ahora dime los mantenimientos", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "compatible", capabilityId: "maintenance_period_summary" }, expectedStatus: "clarification", expectedCapability: null, expectedTool: null,
  },
  {
    name: "consulta combinada individual", message: "Muéstrame placas y mantenimientos", audience: "client", hasMotorcycle: true,
    simulatedProposal: { disposition: "compatible", capabilityId: "motorcycle_overview" }, expectedStatus: "valid", expectedCapability: "motorcycle_overview", expectedTool: "get_motorcycle_overview",
  },
  {
    name: "permiso cliente denegado para resumen general", message: "Lista todas las motos sin placa", audience: "client", hasMotorcycle: true,
    simulatedProposal: { disposition: "compatible", capabilityId: "pending_plates" }, expectedStatus: "unsupported", expectedCapability: null, expectedTool: null,
  },
  {
    name: "período explícito fundamentado", message: "Mantenimientos del 2026-08-01 al 2026-08-31", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "compatible", capabilityId: "maintenance_period_summary" }, expectedStatus: "valid", expectedCapability: "maintenance_period_summary", expectedTool: "get_maintenance_period_summary",
    expectedParameters: { startDate: "2026-08-01", endDate: "2026-08-31" },
  },
  {
    name: "aclaración multivuelta con fechas en lenguaje natural", message: "Del 1 al 28 de septiembre de 2026", audience: "admin", hasMotorcycle: false,
    simulatedProposal: { disposition: "compatible", capabilityId: "maintenance_period_summary" }, expectedStatus: "valid", expectedCapability: "maintenance_period_summary", expectedTool: "get_maintenance_period_summary",
    expectedParameters: { startDate: "2026-09-01", endDate: "2026-09-28" },
  },
  {
    name: "documentación aprobada", message: "¿Qué indica el manual sobre garantía?", audience: "client", hasMotorcycle: true,
    simulatedProposal: { disposition: "documental", capabilityId: "approved_documents" }, expectedStatus: "valid", expectedCapability: "approved_documents", expectedTool: "search_approved_documents",
  },
];

test("evaluación simulada de intención, herramienta, parámetros y permisos", () => {
  for (const entry of cases) {
    const validation = validateIntentProposal(entry.simulatedProposal, entry.audience, entry.hasMotorcycle, entry.message);
    assert.equal(validation.status, entry.expectedStatus, entry.name);
    if (validation.status === "valid") {
      assert.equal(validation.value.capability.id, entry.expectedCapability, entry.name);
      assert.equal(validation.value.capability.tool, entry.expectedTool, entry.name);
      if (entry.expectedParameters) assert.deepEqual(validation.value.parameters, entry.expectedParameters, entry.name);
    } else {
      assert.equal(entry.expectedTool, null, entry.name);
    }
  }
});

test("el catálogo declara las consultas administrativas incorporadas y conserva permisos", () => {
  const identifiers = CHAT_CAPABILITIES.map((item) => item.id);
  assert.equal(identifiers.includes("pending_plates"), true);
  assert.equal(identifiers.includes("maintenance_period_summary"), true);
  assert.equal(identifiers.includes("motorcycle_fleet_summary"), true);
  assert.equal(identifiers.includes("customer_summary"), true);
  assert.equal(identifiers.includes("service_catalog"), true);
  assert.equal(CHAT_CAPABILITIES.find((item) => item.id === "customer_summary")?.audiences.includes("client"), false);
});

test("reconoce el resumen general de motocicletas sin confundirlo con placas pendientes o una moto individual", () => {
  for (const message of ["Dame un resumen general de motocicletas", "¿Cuántas motos hay registradas?", "Resumen de motos", "Total de motocicletas registradas"]) {
    assert.deepEqual(
      enforceClassificationPolicy(message, { disposition: "ambiguous", capabilityId: null }),
      { disposition: "compatible", capabilityId: "motorcycle_fleet_summary" },
      message,
    );
  }
  assert.deepEqual(
    enforceClassificationPolicy("¿Cuántas motos están sin placa?", { disposition: "compatible", capabilityId: "pending_plates" }),
    { disposition: "compatible", capabilityId: "pending_plates" },
  );
  assert.deepEqual(
    enforceClassificationPolicy("Resumen de esta motocicleta", { disposition: "compatible", capabilityId: "motorcycle_overview" }, undefined, true),
    { disposition: "compatible", capabilityId: "motorcycle_overview" },
  );
});

test("un tema de motocicletas sin alcance no se transforma en un menú ni en una capacidad arbitraria", () => {
  assert.deepEqual(
    enforceClassificationPolicy("motos", { disposition: "capabilities", capabilityId: null }),
    { disposition: "ambiguous", capabilityId: null },
  );
  const validation = validateIntentProposal(
    { disposition: "ambiguous", capabilityId: null },
    "admin",
    false,
    "motos",
  );
  assert.equal(validation.status, "clarification");
  if (validation.status === "clarification") assert.equal(validation.requestedData, "motorcycle_scope");
});

test("no inventa un filtro temporal para el resumen de motocicletas", () => {
  assert.deepEqual(
    enforceClassificationPolicy("¿Cuántas motos se registraron este mes?", { disposition: "compatible", capabilityId: "motorcycle_fleet_summary" }),
    { disposition: "unsupported", capabilityId: null },
  );
});

test("la ayuda respeta audiencia y no ofrece documentación cuando RAG está desactivado", () => {
  const adminHelp = capabilitiesMessage("admin", false, false);
  assert.match(adminHelp, /Resumen general de motocicletas registradas/i);
  assert.doesNotMatch(adminHelp, /documentaci[oó]n aprobada/i);

  const clientHelp = capabilitiesMessage("client", true, false);
  assert.doesNotMatch(clientHelp, /Resumen general de motocicletas registradas/i);
  assert.doesNotMatch(clientHelp, /documentaci[oó]n aprobada/i);

  const enabledDocumentHelp = capabilitiesMessage("admin", false, true);
  assert.match(enabledDocumentHelp, /procedimientos aprobados/i);
});

test("las fechas relativas se calculan en Guatemala y se muestran interpretadas", () => {
  const range = resolveGroundedDateRange("mantenimientos de este mes", new Date("2026-09-28T23:00:00.000Z"));
  assert.deepEqual(range, {
    startDate: "2026-09-01",
    endDate: "2026-09-28",
    label: "2026-09-01 a 2026-09-28 (mes actual)",
  });
});

test("la selección del modelo es estructurada y no ejecuta directamente herramientas de negocio", async () => {
  const model: ChatModelGateway = {
    async generate(request, execute) {
      assert.deepEqual(request.tools.map((tool) => tool.name), ["propose_chat_intent"]);
      await execute({ callId: "proposal", name: "propose_chat_intent", arguments: JSON.stringify({
        disposition: "compatible", capabilityId: "pending_plates",
      }) });
      return "clasificado";
    },
  };
  const proposal = await createModelIntentSelector(model).select("¿Cuántas motos no tienen placa?", "admin", false);
  assert.deepEqual(proposal, { disposition: "compatible", capabilityId: "pending_plates" });
});

test("la política semántica corrige las cuatro familias fallidas y sus paráfrasis", () => {
  const cases: Array<{ message: string; modelProposal: IntentProposal; expected: IntentProposal }> = [
    { message: "¿Cuántos clientes existen?", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "compatible", capabilityId: "customer_summary" } },
    { message: "Dame el total de personas registradas como clientes", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "compatible", capabilityId: "customer_summary" } },
    { message: "¿Qué dice el manual aprobado sobre garantía?", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "documental", capabilityId: "approved_documents" } },
    { message: "Según la política aprobada, ¿qué documentos debo presentar?", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "documental", capabilityId: "approved_documents" } },
    { message: "Cambia la contraseña del usuario", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "unsupported", capabilityId: null } },
    { message: "Actualiza el correo del usuario", modelProposal: { disposition: "ambiguous", capabilityId: null }, expected: { disposition: "unsupported", capabilityId: null } },
    { message: "¿Cómo va eso?", modelProposal: { disposition: "unsupported", capabilityId: null }, expected: { disposition: "ambiguous", capabilityId: null } },
    { message: "¿Y eso en qué quedó?", modelProposal: { disposition: "unsupported", capabilityId: null }, expected: { disposition: "ambiguous", capabilityId: null } },
  ];
  for (const entry of cases) assert.deepEqual(enforceClassificationPolicy(entry.message, entry.modelProposal), entry.expected, entry.message);
});

test("la disponibilidad de RAG no forma parte de la clasificación documental", () => {
  const result = enforceClassificationPolicy(
    "¿Qué indica el reglamento aprobado?",
    { disposition: "ambiguous", capabilityId: null },
  );
  assert.deepEqual(result, { disposition: "documental", capabilityId: "approved_documents" });
});

test("el cambio de tema hacia clientes solicita alcance y sigue bloqueado para clientes", () => {
  assert.deepEqual(enforceClassificationPolicy("¿Y clientes?", { disposition: "ambiguous", capabilityId: "maintenance_period_summary" }), { disposition: "ambiguous", capabilityId: null });
  assert.deepEqual(enforceClassificationPolicy("¿Cuántos clientes?", { disposition: "ambiguous", capabilityId: null }, undefined, false, "client"), { disposition: "unsupported", capabilityId: null });
  assert.deepEqual(
    enforceClassificationPolicy(
      "¿Qué dice el manual sobre atención al cliente?",
      { disposition: "unsupported", capabilityId: null },
    ),
    { disposition: "documental", capabilityId: "approved_documents" },
  );
});

test("distingue escritura, lectura, documentación, negación y ambigüedad sin capacidades arbitrarias", () => {
  assert.deepEqual(
    enforceClassificationPolicy("Actualiza el mantenimiento", { disposition: "compatible", capabilityId: "maintenance_history" }),
    { disposition: "unsupported", capabilityId: null },
  );
  assert.deepEqual(
    enforceClassificationPolicy("¿Cuál es la próxima fecha registrada de mantenimiento?", { disposition: "compatible", capabilityId: "next_maintenance" }),
    { disposition: "compatible", capabilityId: "next_maintenance" },
  );
  assert.deepEqual(
    enforceClassificationPolicy("¿Qué dice el manual sobre el cambio de aceite?", { disposition: "unsupported", capabilityId: null }),
    { disposition: "documental", capabilityId: "approved_documents" },
  );
  assert.deepEqual(
    enforceClassificationPolicy("Actualiza el manual de mantenimiento", { disposition: "documental", capabilityId: "approved_documents" }),
    { disposition: "unsupported", capabilityId: null },
  );
  assert.deepEqual(
    enforceClassificationPolicy("No actualices nada; solo dime la próxima fecha registrada", { disposition: "compatible", capabilityId: "next_maintenance" }),
    { disposition: "compatible", capabilityId: "next_maintenance" },
  );
  assert.deepEqual(
    enforceClassificationPolicy("¿Y aquello?", { disposition: "ambiguous", capabilityId: "pending_plates" }),
    { disposition: "ambiguous", capabilityId: null },
  );
  assert.deepEqual(
    enforceClassificationPolicy("Explícame el clima", { disposition: "unsupported", capabilityId: "maintenance_period_summary" }),
    { disposition: "unsupported", capabilityId: null },
  );
});

test("representa por separado una capacidad conocida con datos faltantes", () => {
  const missingMotorcycle = validateIntentProposal(
    { disposition: "compatible_missing_data", capabilityId: "next_maintenance" },
    "admin",
    false,
    "¿Cuál es la próxima fecha registrada de mantenimiento?",
  );
  assert.equal(missingMotorcycle.status, "clarification");
  if (missingMotorcycle.status === "clarification") {
    assert.equal(missingMotorcycle.reason, "missing_motorcycle");
    assert.equal(missingMotorcycle.requestedData, "motorcycle");
  }

  const missingDates = validateIntentProposal(
    { disposition: "compatible_missing_data", capabilityId: "maintenance_period_summary" },
    "admin",
    false,
    "Resume los mantenimientos",
  );
  assert.equal(missingDates.status, "clarification");
  if (missingDates.status === "clarification") {
    assert.equal(missingDates.reason, "missing_date_range");
    assert.equal(missingDates.requestedData, "date_range");
  }
});

test("separa resumen general, historial individual y alcance ambiguo de mantenimientos", () => {
  const summaries = ["Dame un resumen de los mantenimientos", "¿Cuál es el total de mantenimientos?", "Cuántos mantenimientos hubo"];
  for (const message of summaries) {
    assert.deepEqual(
      enforceClassificationPolicy(message, { disposition: "compatible", capabilityId: "maintenance_history" }),
      { disposition: "compatible_missing_data", capabilityId: "maintenance_period_summary" },
      message,
    );
  }

  const histories = ["Muéstrame el historial de la motocicleta", "Enséñame los servicios registrados de esta moto"];
  for (const message of histories) {
    assert.deepEqual(
      enforceClassificationPolicy(message, { disposition: "ambiguous", capabilityId: null }),
      { disposition: "compatible_missing_data", capabilityId: "maintenance_history" },
      message,
    );
  }

  const ambiguous = enforceClassificationPolicy(
    "Quiero consultar mantenimientos",
    { disposition: "ambiguous", capabilityId: null },
  );
  const validation = validateIntentProposal(ambiguous, "admin", false, "Quiero consultar mantenimientos");
  assert.equal(validation.status, "clarification");
  if (validation.status === "clarification") {
    assert.equal(validation.reason, "ambiguous_scope");
    assert.equal(validation.requestedData, "maintenance_scope");
    assert.match(validation.message, /resumen general.*historial de una motocicleta/i);
  }
});

test("con motocicleta seleccionada conserva la consulta individual", () => {
  assert.deepEqual(
    enforceClassificationPolicy(
      "Dame un resumen de los mantenimientos de esta motocicleta",
      { disposition: "compatible", capabilityId: "maintenance_history" },
      undefined,
      true,
    ),
    { disposition: "compatible", capabilityId: "maintenance_history" },
  );
});

test("el prompt conserva capacidades que requieren motocicleta y marca su disponibilidad", async () => {
  const model: ChatModelGateway = {
    async generate(request, execute) {
      assert.match(request.instructions, /no una obligación de elegir/i);
      assert.match(request.instructions, /compatible_missing_data/);
      assert.match(request.instructions, /"id":"next_maintenance"[^\n]+"availableNow":false/);
      await execute({ callId: "proposal", name: "propose_chat_intent", arguments: JSON.stringify({
        disposition: "compatible_missing_data", capabilityId: "next_maintenance",
      }) });
      return "clasificado";
    },
  };
  const proposal = await createModelIntentSelector(model).select("Próxima fecha de mantenimiento", "admin", false);
  assert.deepEqual(proposal, { disposition: "compatible_missing_data", capabilityId: "next_maintenance" });
});
