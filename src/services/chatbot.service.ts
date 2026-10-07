import type { FunctionTool } from "openai/resources/responses/responses";
import type { ChatHistoryMessage, ToolCallRequest } from "../interfaces/chatbot.interface.js";
import { env } from "../config/env.js";
import { withScopedChatbotMcp, type ChatbotMcpToolName } from "../mcp/chatbot-mcp.service.js";
import {
  createFileDocumentSearch,
  emptyDocumentSearch,
  type DocumentAudience,
  type DocumentEvidence,
  type DocumentSearch,
} from "../rag/document-index.js";
import {
  capabilitiesMessage,
  createModelIntentSelector,
  resolveGroundedDateRange,
  validateIntentProposal,
  type CapabilityId,
  type ChatAudience,
  type IntentProposal,
  type IntentSelector,
} from "./chatbot-capabilities.service.js";
import type { ChatbotConversationState } from "./chatbot-conversation.service.js";
import {
  getMaintenancePageByMotorcycle,
  getMaintenancePeriodSummary,
  getMotorcycleFleetSummary,
  getMotorcycleSummary,
  getNextMaintenanceByMotorcycle,
  getPendingPlates,
} from "./chatbot-read.service.js";
import {
  openAIChatModelGateway,
  type ChatModelGateway,
  type ToolExecutionOutput,
} from "./chatbot-model.service.js";
import {
  getCustomerDetailByNit,
  getCustomerDetailById,
  getCustomerSummary,
  getMotorcycleList,
  getPlateHistory,
  getReminderList,
  getServiceCatalog,
  getSparePartsCatalog,
  getUsersAndRoles,
  searchCustomers,
} from "./chatbot-admin-read.service.js";

export const MAX_CHAT_MESSAGE_LENGTH = 1_000;
export const MAX_CHAT_HISTORY_MESSAGES = 12;
export const MAX_CHAT_HISTORY_CHARACTERS = 6_000;

const noParameters = { type: "object", properties: {}, required: [], additionalProperties: false };
const paginationParameters = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["page", "pageSize"],
  additionalProperties: false,
};

export const MOTORCYCLE_TOOLS: FunctionTool[] = [
  {
    type: "function", name: "get_motorcycle_overview", strict: true, parameters: paginationParameters,
    description: "Consulta conjuntamente el último estado de placas y los mantenimientos registrados de la motocicleta autorizada.",
  },
  {
    type: "function", name: "get_motorcycle_summary", strict: true, parameters: noParameters,
    description: "Consulta marca, modelo, año, color, placa y la última etapa registrada del trámite de la motocicleta autorizada.",
  },
  {
    type: "function", name: "get_maintenance_history", strict: true, parameters: paginationParameters,
    description: "Consulta mantenimientos registrados y sus servicios para la motocicleta autorizada, con paginación.",
  },
  {
    type: "function", name: "get_next_maintenance", strict: true, parameters: noParameters,
    description: "Consulta la próxima fecha o lectura guardada en el mantenimiento registrado más reciente. No representa una cita confirmada.",
  },
];

export const ADMIN_GENERAL_TOOLS: FunctionTool[] = [
  {
    type: "function", name: "get_motorcycle_fleet_summary", strict: true, parameters: noParameters,
    description: "Cuenta motocicletas registradas, con placa registrada y sin placa registrada. No indica entrega de placa.",
  },
  {
    type: "function", name: "get_pending_plates", strict: true, parameters: paginationParameters,
    description: "Consulta el total y una página de motocicletas sin placa.",
  },
  {
    type: "function", name: "get_maintenance_period_summary", strict: true,
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Fecha inicial YYYY-MM-DD" },
        endDate: { type: "string", description: "Fecha final YYYY-MM-DD" },
      },
      required: ["startDate", "endDate"],
      additionalProperties: false,
    },
    description: "Cuenta mantenimientos y motocicletas distintas en un período explícito.",
  },
  { type: "function", name: "get_customer_summary", strict: true, parameters: noParameters, description: "Consulta totales reales de clientes." },
  { type: "function", name: "search_customers", strict: true, parameters: { type: "object", properties: { query: { type: "string" }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query", "page", "pageSize"], additionalProperties: false }, description: "Busca clientes por criterios permitidos." },
  { type: "function", name: "get_customer_detail", strict: true, parameters: { type: "object", properties: { query: { type: ["string", "null"] }, customerId: { type: ["integer", "null"] }, page: { type: "integer" }, pageSize: { type: "integer" } }, required: ["query", "customerId", "page", "pageSize"], additionalProperties: false }, description: "Consulta un cliente por NIT o por el identificador interno confirmado de una selección previa, y sus motocicletas." },
  { type: "function", name: "get_motorcycle_list", strict: true, parameters: paginationParameters, description: "Lista motocicletas sin exponer factura, VIN o chasis." },
  { type: "function", name: "get_plate_history", strict: true, parameters: noParameters, description: "Consulta el historial de placas de la motocicleta autorizada." },
  { type: "function", name: "get_service_catalog", strict: true, parameters: paginationParameters, description: "Consulta el catálogo de servicios y referencias registradas." },
  { type: "function", name: "get_spare_parts_catalog", strict: true, parameters: paginationParameters, description: "Consulta el catálogo de repuestos." },
  { type: "function", name: "get_users_roles", strict: true, parameters: paginationParameters, description: "Consulta usuarios y roles sin credenciales." },
  { type: "function", name: "get_reminder_list", strict: true, parameters: paginationParameters, description: "Consulta recordatorios registrados." },
  { type: "function", name: "get_dashboard_summary", strict: true, parameters: noParameters, description: "Consulta indicadores generales con definiciones existentes." },
];

export const UNSUPPORTED_MOTORCYCLE_LOOKUP_MESSAGE = "Por ahora puedes consultar una motocicleta por placa o por serie y número de factura. Selecciona una de esas opciones para revisar sus placas y mantenimientos.";
export const CHATBOT_RAG_UNAVAILABLE_MESSAGE = "La consulta de documentación aprobada no está disponible por ahora.";
export const CHATBOT_OUT_OF_SCOPE_MESSAGE = "Esa consulta no está disponible con las opciones actuales.";

function normalizeForIntent(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-GT");
}

function formatDocumentEvidence(evidence: readonly DocumentEvidence[]): string {
  if (evidence.length === 0) return "No encontré información suficiente en la documentación aprobada disponible.";
  const activeVersions = new Map<string, Set<string>>();
  for (const item of evidence) {
    const versions = activeVersions.get(item.documentId) ?? new Set<string>();
    versions.add(item.version);
    activeVersions.set(item.documentId, versions);
  }
  if ([...activeVersions.values()].some((versions) => versions.size > 1)) {
    return "Encontré más de una versión activa del mismo documento y no puedo confirmar cuál está vigente. Solicita que un administrador documental revise las versiones antes de usar esta orientación.";
  }
  const entries = evidence.map((item) => {
    const page = item.page === null ? "sin página" : `página ${item.page}`;
    const effective = item.effectiveDate === null ? "vigencia no confirmada" : `vigente desde ${item.effectiveDate}`;
    return `${item.excerpt}\n[Fuente: ${item.title}, versión ${item.version}, sección ${item.section}, ${page}, ${effective}]`;
  });
  return entries.join("\n\n");
}

export function isUnsupportedMotorcycleLookup(message: string): boolean {
  const value = normalizeForIntent(message);
  const mentionsMotorcycle = /\b(moto|motos|motocicleta|motocicletas|tramite|mantenimiento)\b/.test(value);
  const asksToLocate = /\b(busca|buscar|encuentra|encontrar|consulta|consultar|localiza|localizar|identifica|identificar)\b/.test(value);
  const isAggregateQuery = /\b(cuantas|cuantos|total|resumen|pendientes|todas|todos|lista|entre|periodo)\b/.test(value);
  const namesUnsupportedCriterion = /\b(nit|dpi|vin|chasis|telefono|correo|email|nombre|cliente|id)\b/.test(value)
    || /\bnumero\s+de\s+motor\b/.test(value);
  const requestsCriterion = /\bpor\b|\bcon\s+(?:el|la|su)\b/.test(value);
  return mentionsMotorcycle && asksToLocate && !isAggregateQuery
    && (namesUnsupportedCriterion || requestsCriterion);
}

function parseObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TypeError("Invalid tool arguments"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("Invalid tool arguments");
  return parsed as Record<string, unknown>;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new RangeError(`${field} is outside the permitted range`);
  }
  return Number(value);
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  if (date.toISOString().slice(0, 10) !== value) throw new TypeError(`${field} is not a valid date`);
  return value;
}

function displayed(value: string | null): string {
  return value === null || value.length === 0 ? "No registrado" : value;
}

export function formatMaintenanceHistory(data: Awaited<ReturnType<typeof getMaintenancePageByMotorcycle>>): string {
  if (data.maintenances.length === 0) return "No hay mantenimientos registrados.";
  const sections = data.maintenances.map((maintenance, index) => {
    const services = maintenance.services.length === 0
      ? "No registrado"
      : maintenance.services.map((service) => `- ${service.name}: ${service.description}`).join("\n");
    return [
      `Mantenimiento ${index + 1}`,
      `- Fecha del mantenimiento: ${maintenance.date}`,
      `- Lectura registrada: ${displayed(maintenance.mileage)}`,
      `- Próxima lectura registrada: ${displayed(maintenance.nextMileage)}`,
      `- Próxima fecha registrada: ${displayed(maintenance.nextDate)}`,
      "- Servicios realizados:",
      ...services.split("\n").map((service) => `  ${service}`),
    ].join("\n");
  });
  return ["Historial de mantenimientos registrados", ...sections].join("\n\n");
}

export function formatNextMaintenance(data: Awaited<ReturnType<typeof getNextMaintenanceByMotorcycle>>): string {
  if (data === null) return "No hay próxima fecha o lectura registrada.";
  return [
    "Próximo mantenimiento registrado",
    `- Fecha del mantenimiento de origen: ${data.sourceMaintenanceDate}`,
    `- Próxima lectura registrada: ${displayed(data.nextMileage)}`,
    `- Próxima fecha registrada: ${displayed(data.nextDate)}`,
  ].join("\n");
}

export function formatMotorcycleSummary(data: Awaited<ReturnType<typeof getMotorcycleSummary>>): string {
  if (data === null) return "La motocicleta autorizada no fue encontrada.";
  const state = data.latestPlateState === null
    ? ["- Estado registrado: No registrado", "- Fecha registrada: No registrado"]
    : [`- Estado registrado: ${data.latestPlateState.name}`, `- Fecha registrada: ${data.latestPlateState.registeredDate}`];
  return [
    "Datos registrados de la motocicleta",
    `- Marca: ${data.brand}`,
    `- Modelo: ${data.model}`,
    `- Año: ${data.year}`,
    `- Color: ${data.color}`,
    `- Placa: ${displayed(data.plate)}`,
    "Último estado registrado del trámite de placas",
    ...state,
  ].join("\n");
}

export function formatMotorcycleOverview(
  summary: Awaited<ReturnType<typeof getMotorcycleSummary>>,
  maintenances: Awaited<ReturnType<typeof getMaintenancePageByMotorcycle>>,
): string {
  return [formatMotorcycleSummary(summary), formatMaintenanceHistory(maintenances)].join("\n\n");
}

export function formatPendingPlates(data: Awaited<ReturnType<typeof getPendingPlates>>): string {
  if (data.pagination.total === 0) return "No hay motocicletas pendientes de placa registradas.";
  const motorcycles = data.motorcycles.map((motorcycle, index) => [
    `${index + 1}. ${motorcycle.brand} ${motorcycle.model} (${motorcycle.year})`,
    `   - Color: ${motorcycle.color}`,
    `   - Estado del trámite: ${displayed(motorcycle.latestState)}`,
  ].join("\n"));
  return [
    "Motocicletas pendientes de placa",
    `- Total registrado: ${data.pagination.total}`,
    `- Página consultada: ${data.pagination.page} de ${data.pagination.totalPages}`,
    ...motorcycles,
  ].join("\n");
}

export function formatMotorcycleFleetSummary(data: Awaited<ReturnType<typeof getMotorcycleFleetSummary>>): string {
  return [
    "Resumen general de motocicletas",
    `- Total registrado: ${data.total}`,
    `- Con placa registrada: ${data.withPlate}`,
    `- Sin placa registrada: ${data.withoutPlate}`,
  ].join("\n");
}

export function formatMaintenancePeriodSummary(data: Awaited<ReturnType<typeof getMaintenancePeriodSummary>>): string {
  const period = `del ${readableDate(data.startDate)} al ${readableDate(data.endDate)}`;
  if (data.maintenanceCount === 0) return `No se encontraron mantenimientos registrados ${period}.`;
  return [
    "Resumen de mantenimientos registrados",
    `- Período: ${period}`,
    `- Mantenimientos registrados: ${data.maintenanceCount}`,
    `- Motocicletas con mantenimiento registrado: ${data.motorcycleCount}`,
  ].join("\n");
}

function formatPage<T>(title: string, page: { items: T[]; pagination: { total: number; page: number; totalPages: number } }, render: (item: T, index: number) => string): string {
  if (page.pagination.total === 0) return `${title}\n- No hay registros.`;
  return [title, `- Total registrado: ${page.pagination.total}`, `- Página: ${page.pagination.page} de ${page.pagination.totalPages}`, ...page.items.map(render)].join("\n");
}

function readableDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("es-GT", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function validateChatInput(message: unknown, history: unknown): { message: string; history: ChatHistoryMessage[] } {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new TypeError(`message must contain between 1 and ${MAX_CHAT_MESSAGE_LENGTH} characters`);
  }
  if (history === undefined) return { message: message.trim(), history: [] };
  if (!Array.isArray(history) || history.length > MAX_CHAT_HISTORY_MESSAGES) throw new TypeError("history is invalid");
  const normalized: ChatHistoryMessage[] = [];
  let characterCount = 0;
  for (const item of history) {
    if (typeof item !== "object" || item === null) throw new TypeError("history is invalid");
    const record = item as Record<string, unknown>;
    if ((record.role !== "user" && record.role !== "assistant") || typeof record.content !== "string" || !record.content.trim()) {
      throw new TypeError("history is invalid");
    }
    characterCount += record.content.length;
    normalized.push({ role: record.role, content: record.content.trim() });
  }
  if (characterCount > MAX_CHAT_HISTORY_CHARACTERS) throw new TypeError("history is too large");
  return { message: message.trim(), history: normalized };
}

export interface ChatbotReaders {
  motorcycleSummary: typeof getMotorcycleSummary;
  maintenancePage: typeof getMaintenancePageByMotorcycle;
  nextMaintenance: typeof getNextMaintenanceByMotorcycle;
  pendingPlates: typeof getPendingPlates;
  motorcycleFleetSummary: typeof getMotorcycleFleetSummary;
  maintenancePeriodSummary: typeof getMaintenancePeriodSummary;
  customerSummary: typeof getCustomerSummary;
  customerSearch: typeof searchCustomers;
  customerDetail: typeof getCustomerDetailByNit;
  customerDetailById: typeof getCustomerDetailById;
  motorcycleList: typeof getMotorcycleList;
  plateHistory: typeof getPlateHistory;
  serviceCatalog: typeof getServiceCatalog;
  sparePartsCatalog: typeof getSparePartsCatalog;
  usersRoles: typeof getUsersAndRoles;
  reminderList: typeof getReminderList;
}

const defaultReaders: ChatbotReaders = {
  motorcycleSummary: getMotorcycleSummary,
  maintenancePage: getMaintenancePageByMotorcycle,
  nextMaintenance: getNextMaintenanceByMotorcycle,
  pendingPlates: getPendingPlates,
  motorcycleFleetSummary: getMotorcycleFleetSummary,
  maintenancePeriodSummary: getMaintenancePeriodSummary,
  customerSummary: getCustomerSummary,
  customerSearch: searchCustomers,
  customerDetail: getCustomerDetailByNit,
  customerDetailById: getCustomerDetailById,
  motorcycleList: getMotorcycleList,
  plateHistory: getPlateHistory,
  serviceCatalog: getServiceCatalog,
  sparePartsCatalog: getSparePartsCatalog,
  usersRoles: getUsersAndRoles,
  reminderList: getReminderList,
};

async function executeMotorcycleReadTool(
  readers: ChatbotReaders,
  motorcycleId: number,
  call: ToolCallRequest,
): Promise<ToolExecutionOutput> {
  const args = parseObject(call.arguments);
  if (call.name === "get_motorcycle_overview") {
    const page = positiveInteger(args.page, "page", 100_000);
    const pageSize = positiveInteger(args.pageSize, "pageSize", 20);
    const [summary, maintenances] = await Promise.all([
      readers.motorcycleSummary(motorcycleId),
      readers.maintenancePage(motorcycleId, page, pageSize),
    ]);
    return {
      modelData: {
        status: summary === null ? "not_found" : "found",
        data: { summary, maintenances },
      },
      deterministicText: formatMotorcycleOverview(summary, maintenances),
    } satisfies ToolExecutionOutput;
  }
  if (call.name === "get_motorcycle_summary") {
    const data = await readers.motorcycleSummary(motorcycleId);
    return {
      modelData: data === null ? { status: "not_found" } : { status: "found", data },
      deterministicText: formatMotorcycleSummary(data),
    } satisfies ToolExecutionOutput;
  }
  if (call.name === "get_next_maintenance") {
    const data = await readers.nextMaintenance(motorcycleId);
    return {
      modelData: data === null ? { status: "no_records" } : { status: "found", data },
      deterministicText: formatNextMaintenance(data),
    } satisfies ToolExecutionOutput;
  }
  if (call.name === "get_maintenance_history") {
    const data = await readers.maintenancePage(
      motorcycleId,
      positiveInteger(args.page, "page", 100_000),
      positiveInteger(args.pageSize, "pageSize", 20),
    );
    return {
      modelData: { status: data.pagination.total === 0 ? "no_records" : "found", data },
      deterministicText: formatMaintenanceHistory(data),
    } satisfies ToolExecutionOutput;
  }
  if (call.name === "get_plate_history") {
    const data = await readers.plateHistory(motorcycleId);
    return { modelData: { status: data.length ? "found" : "no_records", data }, deterministicText: data.length === 0 ? "No hay etapas del trámite de placas registradas." : ["Historial del trámite de placas", ...data.map((item, index) => `${index + 1}. Estado registrado: ${displayed(item.state)}\n   Fecha inicial registrada: ${item.firstDate}\n   Fecha de actualización registrada: ${item.updatedDate}`)].join("\n") };
  }
  throw new TypeError("Tool is not permitted");
}

async function executeAdminReadTool(readers: ChatbotReaders, call: ToolCallRequest): Promise<ToolExecutionOutput> {
  const args = parseObject(call.arguments);
  if (call.name === "get_motorcycle_fleet_summary") {
    const data = await readers.motorcycleFleetSummary();
    return { modelData: { status: "found", data }, deterministicText: formatMotorcycleFleetSummary(data) };
  }
  if (call.name === "get_pending_plates") {
    const data = await readers.pendingPlates(
      positiveInteger(args.page, "page", 100_000),
      positiveInteger(args.pageSize, "pageSize", 20),
    );
    return {
      modelData: { status: data.pagination.total === 0 ? "no_records" : "found", data },
      deterministicText: formatPendingPlates(data),
    };
  }
  if (call.name === "get_maintenance_period_summary") {
    const startDate = isoDate(args.startDate, "startDate");
    const endDate = isoDate(args.endDate, "endDate");
    if (startDate > endDate) throw new RangeError("startDate must not be after endDate");
    const data = await readers.maintenancePeriodSummary(startDate, endDate);
    return {
      modelData: { status: data.maintenanceCount === 0 ? "no_records" : "found", data },
      deterministicText: formatMaintenancePeriodSummary(data),
    };
  }
  if (call.name === "get_customer_summary") {
    const data = await readers.customerSummary();
    return { modelData: { status: "found", data }, deterministicText: ["Resumen de clientes", `- Total registrado: ${data.total}`, `- Activos: ${data.active}`, `- Inactivos: ${data.inactive}`, `- Nuevos este mes: ${data.newThisMonth}`].join("\n") };
  }
  if (call.name === "search_customers") {
    if (typeof args.query !== "string") throw new TypeError("query is required");
    const data = await readers.customerSearch(args.query, positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    const formatted = formatPage("Clientes encontrados", data, (item, index) => `${index + 1}. ${item.name} ${item.lastName}\n   NIT: ${item.nit}\n   DPI: ${item.dpi}\n   Teléfono: ${item.phone}\n   Correo: ${item.email}\n   Estado registrado: ${item.state === 1 ? "Activo" : item.state === 0 ? "Inactivo" : "No registrado"}`);
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: data.items.length > 1 ? `${formatted}\nResponde con el número del cliente que deseas consultar.` : formatted };
  }
  if (call.name === "get_customer_detail") {
    const result = typeof args.customerId === "number"
      ? await readers.customerDetailById(positiveInteger(args.customerId, "customerId", Number.MAX_SAFE_INTEGER))
      : typeof args.query === "string" ? await readers.customerDetail(args.query) : null;
    if (result === null) throw new TypeError("customer query is required");
    if (result.status === "not_found") return { modelData: result, deterministicText: "No se encontró un cliente con ese NIT." };
    if (result.status === "ambiguous") return { modelData: result, deterministicText: "El NIT corresponde a más de un cliente. Revisa los datos antes de continuar." };
    const data = result.data;
    const motorcycles = data.motorcycles.length === 0 ? ["- Motocicletas asociadas: No registradas"] : ["Motocicletas asociadas", ...data.motorcycles.map((item, index) => `${index + 1}. ${item.brand} ${item.model} (${item.year})\n   Color: ${item.color}\n   Placa: ${displayed(item.plate)}`)];
    return { modelData: { status: "found", data }, deterministicText: ["Detalle del cliente", `- Nombre: ${data.customer.name} ${data.customer.lastName}`, `- NIT: ${data.customer.nit}`, `- DPI: ${data.customer.dpi}`, `- Teléfono: ${data.customer.phone}`, `- Correo: ${data.customer.email}`, `- Dirección: ${data.customer.address}`, `- Fecha de registro: ${displayed(data.customer.registeredAt)}`, ...motorcycles].join("\n") };
  }
  if (call.name === "get_motorcycle_list") {
    const data = await readers.motorcycleList(positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: formatPage("Motocicletas registradas", data, (item, index) => `${index + 1}. ${item.brand} ${item.model} (${item.year})\n   Color: ${item.color}\n   Placa: ${displayed(item.plate)}`) };
  }
  if (call.name === "get_service_catalog") {
    const data = await readers.serviceCatalog(positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: formatPage("Catálogo de servicios registrados", data, (item, index) => `${index + 1}. ${item.name}\n   Descripción: ${item.description}\n   Lectura recomendada registrada: ${displayed(item.recommendedReading)}\n   Tiempo recomendado registrado: ${displayed(item.recommendedTime)}\n   Precio de referencia registrado: ${displayed(item.referencePrice)}`) };
  }
  if (call.name === "get_spare_parts_catalog") {
    const data = await readers.sparePartsCatalog(positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: formatPage("Catálogo de repuestos registrados", data, (item, index) => `${index + 1}. ${item.name}\n   Marca: ${item.brand}\n   Descripción: ${item.description}`) };
  }
  if (call.name === "get_users_roles") {
    const data = await readers.usersRoles(positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: formatPage("Usuarios y roles", data, (item, index) => `${index + 1}. ${item.name} ${item.lastName}\n   Correo: ${item.email}\n   Teléfono: ${displayed(item.phone)}\n   Rol: ${displayed(item.role)}`) };
  }
  if (call.name === "get_reminder_list") {
    const data = await readers.reminderList(positiveInteger(args.page, "page", 100_000), positiveInteger(args.pageSize, "pageSize", 20));
    return { modelData: { status: data.pagination.total ? "found" : "no_records", data }, deterministicText: formatPage("Recordatorios registrados", data, (item, index) => `${index + 1}. ${item.title}\n   Descripción: ${item.description}\n   Fecha programada registrada: ${item.programmedDate}\n   Tipo: ${item.type}\n   Motocicleta: ${displayed(item.motorcycle)}`) };
  }
  if (call.name === "get_dashboard_summary") {
    const [customers, motorcycles] = await Promise.all([readers.customerSummary(), readers.motorcycleFleetSummary()]);
    const data = { customers, motorcycles };
    return { modelData: { status: "found", data }, deterministicText: ["Indicadores generales", `- Clientes registrados: ${customers.total}`, `- Clientes activos: ${customers.active}`, `- Clientes nuevos este mes: ${customers.newThisMonth}`, `- Motocicletas registradas: ${motorcycles.total}`, `- Con placa registrada: ${motorcycles.withPlate}`, `- Sin placa registrada: ${motorcycles.withoutPlate}`].join("\n") };
  }
  throw new TypeError("Tool is not permitted");
}

export interface ChatbotServiceOptions {
  ragEnabled: boolean;
  documentSearch: DocumentSearch;
  intentSelector?: IntentSelector;
  now?: () => Date;
}

const defaultOptions: ChatbotServiceOptions = {
  ragEnabled: env.CHATBOT_RAG_ENABLED,
  documentSearch: env.CHATBOT_RAG_ENABLED
    ? createFileDocumentSearch(env.CHATBOT_DOCUMENT_INDEX_PATH)
    : emptyDocumentSearch(),
  now: () => new Date(),
};

async function documentChat(
  message: string,
  audience: DocumentAudience,
  options: ChatbotServiceOptions,
): Promise<string> {
  if (!options.ragEnabled) return CHATBOT_RAG_UNAVAILABLE_MESSAGE;
  return withScopedChatbotMcp(["search_approved_documents"], async (call) => {
    const args = parseObject(call.arguments);
    if (call.name !== "search_approved_documents" || typeof args.query !== "string") throw new TypeError("Tool is not permitted");
    const evidence = await options.documentSearch.search(args.query, audience, positiveInteger(args.limit, "limit", 8));
    return { modelData: { status: evidence.length === 0 ? "no_records" : "found", evidence }, deterministicText: formatDocumentEvidence(evidence) };
  }, async (execute) => {
    const output = await execute({ callId: "document-search", name: "search_approved_documents", arguments: JSON.stringify({ query: message, limit: 5 }) });
    return output.deterministicText ?? CHATBOT_RAG_UNAVAILABLE_MESSAGE;
  });
}

function diagnostic(metadata: {
  audience: ChatAudience;
  intent: string;
  tool: string | null;
  validation: string;
  result: string;
}): void {
  console.info(JSON.stringify({ event: "chatbot_query_diagnostic", ...metadata }));
}

function proposalDirectText(disposition: string, audience: ChatAudience, hasMotorcycle: boolean, message: string, ragEnabled: boolean): string | null {
  if (disposition === "greeting") return "Hola. ¿En qué consulta puedo ayudarte?";
  if (disposition === "capabilities") return capabilitiesMessage(audience, hasMotorcycle, ragEnabled);
  if (disposition === "unsupported" && /\b(motocicletas?|motos?)\b/i.test(message)
    && /\b(hoy|ayer|semana|mes|año|fecha|periodo|período|entre|desde|hasta)\b/i.test(message)) {
    return `El resumen general de motocicletas no admite filtros temporales porque no hay una fecha de registro de motocicleta confirmada para esta consulta.\n\n${capabilitiesMessage(audience, hasMotorcycle, ragEnabled)}`;
  }
  if (audience === "client" && disposition === "unsupported" && /\b(clientes?|personas? registradas?)\b/i.test(message)) {
    return `Por ahora no están disponibles las consultas de cantidades o listados de clientes.\n\n${capabilitiesMessage(audience, hasMotorcycle, ragEnabled)}`;
  }
  if (disposition === "unsupported") return `${CHATBOT_OUT_OF_SCOPE_MESSAGE}\n\n${capabilitiesMessage(audience, hasMotorcycle, ragEnabled)}`;
  return null;
}

function toolForName(name: string): FunctionTool {
  const tool = [...MOTORCYCLE_TOOLS, ...ADMIN_GENERAL_TOOLS].find((candidate) => candidate.name === name);
  if (!tool) throw new TypeError("La capacidad no corresponde a una consulta operativa");
  return tool;
}

function pendingUserContext(
  message: string,
  history: ChatHistoryMessage[],
  hasMotorcycle: boolean,
): { previousUserMessage: string } | undefined {
  if (hasMotorcycle || resolveGroundedDateRange(message) === null) return undefined;
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const onlyPeriod = /^(?:(?:del|de)\s+\d{1,2}\s+al\s+\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}|(?:del|de|entre)?\s*\d{4}-\d{2}-\d{2}\s+(?:al|a|y)\s+\d{4}-\d{2}-\d{2}|(?:(?:del|de)\s+)?(?:hoy|este mes|mes actual|mes pasado|ultimo mes))[.!? ]*$/.test(normalized);
  if (!onlyPeriod) return undefined;
  const previousUserMessage = [...history].reverse().find((item) => item.role === "user")?.content.trim();
  return previousUserMessage ? { previousUserMessage } : undefined;
}

export interface ChatbotTurnResult {
  message: string;
  conversationState: ChatbotConversationState | null;
}

function conversationState(
  audience: ChatAudience,
  targetFingerprint: string,
  activeCapabilityId: CapabilityId | null,
  pending: ChatbotConversationState["pending"],
  confirmed: ChatbotConversationState["confirmed"] = {},
): ChatbotConversationState {
  return { audience, targetFingerprint, activeCapabilityId, pending, confirmed, updatedAt: new Date().toISOString() };
}

function isConversationCancellation(message: string): boolean {
  const value = normalizeForIntent(message).trim();
  return /^(?:cancelar|cancela|olvida eso|nueva conversacion|empezar de nuevo|reiniciar)(?:[.! ]*)$/.test(value);
}

function proposalFromPending(
  state: ChatbotConversationState | null,
  message: string,
  hasMotorcycle: boolean,
  now: Date,
): IntentProposal | null {
  const pending = state?.pending;
  const value = normalizeForIntent(message).trim();
  if (!pending && state?.activeCapabilityId === "customer_summary" && /^¿?y\s+(?:las\s+)?(?:motos|motocicletas)\??$/.test(value)) {
    return { disposition: "compatible", capabilityId: "motorcycle_fleet_summary" };
  }
  if (!pending && state?.activeCapabilityId === "motorcycle_fleet_summary" && /^¿?y\s+(?:los\s+)?clientes\??$/.test(value)) {
    return { disposition: "compatible", capabilityId: "customer_summary" };
  }
  if (!pending && state?.activeCapabilityId === "customer_detail"
    && (state.confirmed.query || state.confirmed.customerId)
    && /\b(motos|motocicletas)\b/.test(value)) {
    return { disposition: "compatible", capabilityId: "customer_detail" };
  }
  if (!pending && state?.activeCapabilityId === "customer_search" && state.confirmed.customerCandidates?.length
    && /^\d+$/.test(value)) {
    const index = Number(value) - 1;
    if (state.confirmed.customerCandidates[index]) return { disposition: "compatible", capabilityId: "customer_detail" };
  }
  if (!pending && state?.activeCapabilityId === "maintenance_period_summary"
    && resolveGroundedDateRange(message, now)
    && /^(?:no[, ]+|mejor\s+|corrige\s+|en realidad\s+)/.test(normalizeForIntent(message).trim())) {
    return { disposition: "compatible", capabilityId: "maintenance_period_summary" };
  }
  if (!pending?.capabilityId) return null;
  if (pending.missing === "date_range" && resolveGroundedDateRange(message, now)) {
    return { disposition: "compatible", capabilityId: pending.capabilityId };
  }
  if (pending.missing === "motorcycle" && hasMotorcycle) {
    return { disposition: "compatible", capabilityId: pending.capabilityId };
  }
  if (pending.missing === "maintenance_scope") {
    const value = normalizeForIntent(message);
    if (/\b(general|resumen|periodo|fechas?)\b/.test(value)) {
      return { disposition: "compatible_missing_data", capabilityId: "maintenance_period_summary" };
    }
    if (/\b(historial|motocicleta|moto|individual)\b/.test(value)) {
      return { disposition: hasMotorcycle ? "compatible" : "compatible_missing_data", capabilityId: "maintenance_history" };
    }
  }
  if (pending.missing === "motorcycle_scope") {
    const value = normalizeForIntent(message);
    if (/\b(general|resumen|total|todas|registradas)\b/.test(value)) {
      return { disposition: "compatible", capabilityId: "motorcycle_fleet_summary" };
    }
    if (/\b(individual|placa|factura|una motocicleta|una moto)\b/.test(value)) {
      return { disposition: "compatible_missing_data", capabilityId: "motorcycle_overview" };
    }
  }
  return null;
}

export function createChatbotService(
  model: ChatModelGateway,
  readers: ChatbotReaders = defaultReaders,
  options: ChatbotServiceOptions = defaultOptions,
) {
  const intentSelector = options.intentSelector ?? createModelIntentSelector(model);
  async function run(
    audience: ChatAudience,
    motorcycleId: number | null,
    message: string,
    history: ChatHistoryMessage[],
    state: ChatbotConversationState | null = null,
    targetFingerprint = motorcycleId === null ? "general" : `motorcycle:${motorcycleId}`,
  ): Promise<ChatbotTurnResult> {
    if (isConversationCancellation(message)) {
      return { message: "Conversación reiniciada. Indica qué deseas consultar.", conversationState: null };
    }
    const now = options.now?.() ?? new Date();
    const proposal = proposalFromPending(state, message, motorcycleId !== null, now)
      ?? await intentSelector.select(
        message,
        audience,
        motorcycleId !== null,
        state ? undefined : pendingUserContext(message, history, motorcycleId !== null),
      );
    const direct = proposalDirectText(proposal.disposition, audience, motorcycleId !== null, message, options.ragEnabled);
    if (direct !== null) {
      diagnostic({ audience, intent: proposal.capabilityId ?? proposal.disposition, tool: null, validation: proposal.disposition, result: "not_executed" });
      return { message: direct, conversationState: null };
    }
    const selectedCandidate = proposal.capabilityId === "customer_detail" && /^\d+$/.test(message.trim())
      ? state?.confirmed.customerCandidates?.[Number(message.trim()) - 1]?.customerId
      : undefined;
    const confirmedCustomerId = proposal.capabilityId === "customer_detail"
      && /\b(motos|motocicletas)\b/.test(normalizeForIntent(message))
      ? state?.confirmed.customerId
      : undefined;
    const resolvedCustomerId = selectedCandidate ?? confirmedCustomerId;
    const confirmedQuery = state?.confirmed.query;
    const validationMessage = resolvedCustomerId !== undefined
      ? "Detalle del cliente con NIT seleccionado"
      : proposal.capabilityId === "customer_detail" && confirmedQuery ? `${message} NIT ${confirmedQuery}` : message;
    const validation = validateIntentProposal(proposal, audience, motorcycleId !== null, validationMessage, now);
    if (validation.status !== "valid") {
      diagnostic({ audience, intent: proposal.capabilityId ?? proposal.disposition, tool: null, validation: validation.status, result: "not_executed" });
      const nextState = validation.status === "clarification"
        ? conversationState(
          audience,
          targetFingerprint,
          proposal.capabilityId,
          { capabilityId: proposal.capabilityId, missing: validation.requestedData },
          state?.confirmed ?? {},
        )
        : null;
      return { message: validation.message, conversationState: nextState };
    }
    const { capability, interpretedPeriod } = validation.value;
    const parameters: Record<string, string | number | null> = resolvedCustomerId === undefined
      ? { ...validation.value.parameters, ...(capability.id === "customer_detail" ? { customerId: null } : {}) }
      : { query: null, customerId: resolvedCustomerId, page: 1, pageSize: 10 };
    if (capability.id === "approved_documents") {
      try {
        const answer = await documentChat(message, audience, options);
        diagnostic({ audience, intent: capability.id, tool: capability.tool, validation: "valid", result: answer === CHATBOT_RAG_UNAVAILABLE_MESSAGE ? "disabled" : "success" });
        return {
          message: answer,
          conversationState: conversationState(audience, targetFingerprint, capability.id, null, {}),
        };
      } catch (error: unknown) {
        diagnostic({ audience, intent: capability.id, tool: capability.tool, validation: "valid", result: "dependency_failure" });
        throw error;
      }
    }
    const tool = toolForName(capability.tool);
    try {
      let executedModelData: unknown;
      const answer = await withScopedChatbotMcp([capability.tool as ChatbotMcpToolName], async (call) => {
        const output = motorcycleId !== null && (MOTORCYCLE_TOOLS.some((candidate) => candidate.name === call.name) || call.name === "get_plate_history")
          ? await executeMotorcycleReadTool(readers, motorcycleId, call)
          : await executeAdminReadTool(readers, call);
        executedModelData = output.modelData;
        return output;
      }, async (execute) => {
        const output = await execute({ callId: "validated-query", name: capability.tool, arguments: JSON.stringify(parameters) });
        if (output.deterministicText === undefined) throw new TypeError("La consulta no produjo una respuesta respaldada");
        return output.deterministicText;
      });
      diagnostic({ audience, intent: capability.id, tool: tool.name, validation: interpretedPeriod ? `valid:${interpretedPeriod}` : "valid", result: "success" });
      let confirmed: ChatbotConversationState["confirmed"] = capability.id === "maintenance_period_summary"
        ? { startDate: String(parameters.startDate), endDate: String(parameters.endDate) }
        : capability.id === "customer_detail" && typeof parameters.customerId === "number"
          ? { customerId: parameters.customerId }
          : capability.id === "customer_detail" && typeof parameters.query === "string" ? { query: parameters.query } : {};
      if (capability.id === "customer_search" && typeof executedModelData === "object" && executedModelData !== null) {
        const data = (executedModelData as { data?: unknown }).data;
        const items = typeof data === "object" && data !== null ? (data as { items?: unknown }).items : undefined;
        if (Array.isArray(items)) {
          confirmed = { customerCandidates: items.flatMap((item) => {
            if (typeof item !== "object" || item === null) return [];
            const customerId = (item as { id?: unknown }).id;
            return typeof customerId === "number" && Number.isInteger(customerId) && customerId > 0 ? [{ customerId }] : [];
          }) };
        }
      }
      return {
        message: answer,
        conversationState: conversationState(audience, targetFingerprint, capability.id, null, confirmed),
      };
    } catch (error: unknown) {
      diagnostic({ audience, intent: capability.id, tool: tool.name, validation: "valid", result: "dependency_failure" });
      throw error;
    }
  }
  return {
    async clientChat(motorcycleId: number, message: string, history: ChatHistoryMessage[]): Promise<string> {
      return (await run("client", motorcycleId, message, history)).message;
    },
    async clientChatTurn(
      motorcycleId: number,
      message: string,
      history: ChatHistoryMessage[],
      state: ChatbotConversationState | null,
      targetFingerprint: string,
    ): Promise<ChatbotTurnResult> {
      return run("client", motorcycleId, message, history, state, targetFingerprint);
    },
    async adminChat(
      motorcycleId: number | null,
      message: string,
      history: ChatHistoryMessage[],
      context?: { targetConflict: boolean },
    ): Promise<string> {
      if (context?.targetConflict) {
        diagnostic({ audience: "admin", intent: "target_conflict", tool: null, validation: "clarification", result: "not_executed" });
        return "El identificador escrito no coincide con la motocicleta seleccionada. Confirma si deseas usar la selección actual o cambia el destino antes de consultar.";
      }
      if (motorcycleId === null && isUnsupportedMotorcycleLookup(message)) {
        diagnostic({ audience: "admin", intent: "unsupported_motorcycle_lookup", tool: null, validation: "unsupported", result: "not_executed" });
        return UNSUPPORTED_MOTORCYCLE_LOOKUP_MESSAGE;
      }
      return (await run("admin", motorcycleId, message, history)).message;
    },
    async adminChatTurn(
      motorcycleId: number | null,
      message: string,
      history: ChatHistoryMessage[],
      state: ChatbotConversationState | null,
      targetFingerprint: string,
      context?: { targetConflict: boolean },
    ): Promise<ChatbotTurnResult> {
      if (context?.targetConflict) {
        diagnostic({ audience: "admin", intent: "target_conflict", tool: null, validation: "clarification", result: "not_executed" });
        return {
          message: "El identificador escrito no coincide con la motocicleta seleccionada. Confirma si deseas usar la selección actual o cambia el destino antes de consultar.",
          conversationState: state,
        };
      }
      if (motorcycleId === null && isUnsupportedMotorcycleLookup(message)) {
        diagnostic({ audience: "admin", intent: "unsupported_motorcycle_lookup", tool: null, validation: "unsupported", result: "not_executed" });
        return { message: UNSUPPORTED_MOTORCYCLE_LOOKUP_MESSAGE, conversationState: null };
      }
      return run("admin", motorcycleId, message, history, state, targetFingerprint);
    },
  };
}

export const chatbotService = createChatbotService(openAIChatModelGateway);
