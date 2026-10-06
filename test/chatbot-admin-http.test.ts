import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createChatbotService, validateChatInput, type ChatbotReaders } from "../src/services/chatbot.service.js";
import type { ChatModelGateway } from "../src/services/chatbot-model.service.js";
import type { ChatbotConversationState } from "../src/services/chatbot-conversation.service.js";

interface ChatBody {
  message: string;
  history?: unknown;
  conversationId: string;
}

function fakeReaders(observed: { searches: string[]; detailIds: number[]; detailByNit: number }): ChatbotReaders {
  return {
    async motorcycleSummary() { return null; },
    async maintenancePage(_id, page, pageSize) { return { maintenances: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async nextMaintenance() { return null; },
    async pendingPlates(page, pageSize) { return { motorcycles: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async motorcycleFleetSummary() { return { total: 0, withPlate: 0, withoutPlate: 0 }; },
    async maintenancePeriodSummary(startDate, endDate) { return { startDate, endDate, maintenanceCount: 1, motorcycleCount: 1 }; },
    async customerSummary() { return { total: 3, active: 2, inactive: 1, newThisMonth: 1 }; },
    async customerSearch(query, page, pageSize) {
      observed.searches.push(query);
      return { items: [
        { id: 11, name: "Ana María", lastName: "Primera", dpi: "1", nit: "NIT-DUP", phone: "00000001", email: "uno@example.invalid", state: 1, registeredAt: null },
        { id: 22, name: "Ana María", lastName: "Segunda", dpi: "2", nit: "NIT-DUP", phone: "00000002", email: "dos@example.invalid", state: 1, registeredAt: null },
      ], pagination: { page, pageSize, total: 2, totalPages: 1 } };
    },
    async customerDetail() { observed.detailByNit += 1; return { status: "ambiguous" }; },
    async customerDetailById(customerId) {
      observed.detailIds.push(customerId);
      return { status: "found", data: {
        customer: { id: customerId, name: "Ana María", lastName: "Segunda", dpi: "2", nit: "NIT-DUP", phone: "00000002", email: "dos@example.invalid", address: "Dirección ficticia", state: 1, registeredAt: null },
        motorcycles: [{ id: 91, brand: "Marca Ficticia", model: "Modelo Dos", year: "2026", color: "Azul", plate: null, state: 1 }],
      } };
    },
    async motorcycleList(page, pageSize) { return { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async plateHistory() { return []; },
    async serviceCatalog(page, pageSize) { return { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async sparePartsCatalog(page, pageSize) { return { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async usersRoles(page, pageSize) { return { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
    async reminderList(page, pageSize) { return { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }; },
  };
}

function simulatedModel(): ChatModelGateway {
  return {
    async generate(request, executeTool) {
      const normalized = request.message.toLocaleLowerCase("es-GT");
      const capabilityId = normalized.includes("mantenimiento")
        ? "maintenance_period_summary"
        : /\b(busca|buscar|encuentra|encontrar)\b/.test(normalized) ? "customer_search" : "customer_summary";
      const disposition = capabilityId === "maintenance_period_summary" ? "compatible_missing_data" : "compatible";
      await executeTool({ callId: "simulated-intent", name: "propose_chat_intent", arguments: JSON.stringify({ disposition, capabilityId }) });
      return { text: "Clasificación simulada", usage: null, responseCalls: 1 };
    },
  };
}

async function createHttpHarness() {
  const observed = { searches: [] as string[], detailIds: [] as number[], detailByNit: 0 };
  const states = new Map<string, ChatbotConversationState>();
  const service = createChatbotService(simulatedModel(), fakeReaders(observed), {
    ragEnabled: false,
    documentSearch: { async search() { return []; } },
    now: () => new Date("2026-10-06T12:00:00-06:00"),
  });
  const app = express();
  app.use(express.json());
  app.post("/api/chatbot/admin/chat", async (req, res) => {
    if (req.headers.authorization !== "Bearer fictitious-admin-token") return res.status(401).json({ message: "Unauthorized" });
    try {
      const body = req.body as ChatBody;
      if (typeof body.conversationId !== "string") return res.status(400).json({ message: "Revisa la conversación seleccionada" });
      const input = validateChatInput(body.message, body.history);
      const turn = await service.adminChatTurn(null, input.message, input.history, states.get(body.conversationId) ?? null, "general");
      if (turn.conversationState) states.set(body.conversationId, turn.conversationState);
      else states.delete(body.conversationId);
      return res.json({ message: turn.message });
    } catch {
      return res.status(500).json({ message: "Fallo de prueba" });
    }
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = createServer(app);
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, observed, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function post(baseUrl: string, conversationId: string, message: string, history: unknown[] = []): Promise<{ status: number; message: string }> {
  const response = await fetch(`${baseUrl}/api/chatbot/admin/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fictitious-admin-token" },
    body: JSON.stringify({ conversationId, message, history }),
  });
  const body = await response.json() as { message: string };
  return { status: response.status, message: body.message };
}

test("HTTP conserva customer_summary directo y después de cambiar desde mantenimientos", async () => {
  const harness = await createHttpHarness();
  try {
    const direct = await post(harness.baseUrl, "summary_customer_01", "Dame un resumen de clientes");
    assert.equal(direct.status, 200);
    assert.match(direct.message, /Total registrado: 3/);
    const clarification = await post(harness.baseUrl, "topic_change_0001", "Dame un resumen de los mantenimientos");
    assert.match(clarification.message, /fecha inicial y final/i);
    const period = await post(harness.baseUrl, "topic_change_0001", "2026-09-01 a 2026-09-30");
    assert.match(period.message, /Mantenimientos registrados: 1/);
    const changed = await post(harness.baseUrl, "topic_change_0001", "¿y clientes?");
    assert.equal(changed.status, 200);
    assert.match(changed.message, /Total registrado: 3/);
    assert.doesNotMatch(changed.message, /fecha inicial|fecha final/i);
  } finally { await harness.close(); }
});

test("HTTP extrae nombres compuestos de variantes de búsqueda desde el mensaje", async () => {
  const harness = await createHttpHarness();
  try {
    for (const [index, message] of ["Busca clientes llamados Ana María Pérez", "Encuentra al cliente de nombre Ana María Pérez"] .entries()) {
      const response = await post(harness.baseUrl, `compound_name_${index}0000`, message);
      assert.equal(response.status, 200);
      assert.match(response.message, /Ana María Primera/);
    }
    assert.deepEqual(harness.observed.searches, ["Ana María Pérez", "Ana María Pérez"]);
  } finally { await harness.close(); }
});

test("HTTP completa búsqueda, selección y motos exclusivamente por CUIdCustomer", async () => {
  const harness = await createHttpHarness();
  try {
    const conversationId = "customer_flow_0001";
    const search = await post(harness.baseUrl, conversationId, "Busca clientes llamados Ana María");
    assert.match(search.message, /Responde con el número/);
    const selected = await post(harness.baseUrl, conversationId, "2", [{ role: "user", content: "Busca clientes llamados Ana María" }, { role: "assistant", content: search.message }]);
    assert.match(selected.message, /Ana María Segunda/);
    const motorcycles = await post(harness.baseUrl, conversationId, "¿Qué motos tiene?", [{ role: "assistant", content: selected.message }]);
    assert.equal(motorcycles.status, 200);
    assert.match(motorcycles.message, /Marca Ficticia Modelo Dos/);
    assert.deepEqual(harness.observed.searches, ["Ana María"]);
    assert.deepEqual(harness.observed.detailIds, [22, 22]);
    assert.equal(harness.observed.detailByNit, 0);
  } finally { await harness.close(); }
});
