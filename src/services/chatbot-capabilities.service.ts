import type { FunctionTool } from "openai/resources/responses/responses";
import type { ChatModelGateway } from "./chatbot-model.service.js";

export type ChatAudience = "client" | "admin";
export type CapabilityId =
  | "motorcycle_overview"
  | "motorcycle_plate_status"
  | "maintenance_history"
  | "next_maintenance"
  | "pending_plates"
  | "motorcycle_fleet_summary"
  | "maintenance_period_summary"
  | "customer_summary"
  | "customer_search"
  | "customer_detail"
  | "motorcycle_list"
  | "plate_history"
  | "service_catalog"
  | "spare_parts_catalog"
  | "users_roles"
  | "reminder_list"
  | "dashboard_summary"
  | "approved_documents";

export interface ChatCapability {
  id: CapabilityId;
  audiences: ChatAudience[];
  requiresMotorcycle: boolean;
  requiredParameters: Array<"dateRange" | "searchTerm">;
  tool: string;
  description: string;
  examples: string[];
}

export const CHAT_CAPABILITIES: readonly ChatCapability[] = [
  { id: "motorcycle_overview", audiences: ["client", "admin"], requiresMotorcycle: true, requiredParameters: [], tool: "get_motorcycle_overview", description: "Estado de placas y mantenimientos de la motocicleta seleccionada.", examples: ["Muéstrame placas y mantenimientos", "Quiero el resumen completo de esta moto"] },
  { id: "motorcycle_plate_status", audiences: ["client", "admin"], requiresMotorcycle: true, requiredParameters: [], tool: "get_motorcycle_summary", description: "Datos y último estado registrado de placas de la motocicleta seleccionada.", examples: ["¿Cuál es el estado de su placa?", "¿Cómo va el trámite de esta motocicleta?"] },
  { id: "maintenance_history", audiences: ["client", "admin"], requiresMotorcycle: true, requiredParameters: [], tool: "get_maintenance_history", description: "Mantenimientos y servicios registrados de la motocicleta seleccionada.", examples: ["Enséñame sus mantenimientos", "¿Qué servicios tiene registrados?"] },
  { id: "next_maintenance", audiences: ["client", "admin"], requiresMotorcycle: true, requiredParameters: [], tool: "get_next_maintenance", description: "Próxima fecha o lectura guardada en el mantenimiento más reciente.", examples: ["¿Cuál es el próximo mantenimiento registrado?", "Muéstrame la próxima fecha guardada"] },
  { id: "pending_plates", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_pending_plates", description: "Total real y página de motocicletas sin placa.", examples: ["¿Cuántas motos están sin placa?", "Lista las motocicletas pendientes de placa"] },
  { id: "motorcycle_fleet_summary", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_motorcycle_fleet_summary", description: "Resumen general de motocicletas registradas, con placa y sin placa.", examples: ["Dame un resumen general de motocicletas", "¿Cuántas motos hay registradas?", "Resumen de motos"] },
  { id: "maintenance_period_summary", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: ["dateRange"], tool: "get_maintenance_period_summary", description: "Resumen de mantenimientos dentro de un período indicado.", examples: ["Resume los mantenimientos de septiembre", "¿Cuántos mantenimientos hubo del 1 al 30?"] },
  { id: "customer_summary", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_customer_summary", description: "Totales de clientes registrados, activos, inactivos y nuevos del mes.", examples: ["¿Cuántos clientes hay?", "Resumen de clientes"] },
  { id: "customer_search", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: ["searchTerm"], tool: "search_customers", description: "Búsqueda paginada de clientes por nombre, DPI, NIT, teléfono o correo.", examples: ["Busca al cliente Ana", "Busca el DPI 1234"] },
  { id: "customer_detail", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: ["searchTerm"], tool: "get_customer_detail", description: "Detalle de un cliente identificado por NIT y sus motocicletas asociadas.", examples: ["Detalle del cliente con NIT 1234", "¿Qué motos tiene el NIT 1234?"] },
  { id: "motorcycle_list", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_motorcycle_list", description: "Listado paginado de motocicletas registradas y sus características públicas.", examples: ["Lista las motocicletas", "Muéstrame las motos registradas"] },
  { id: "plate_history", audiences: ["admin"], requiresMotorcycle: true, requiredParameters: [], tool: "get_plate_history", description: "Historial de etapas registradas del trámite de placas de la motocicleta seleccionada.", examples: ["Historial del trámite de placas", "Muéstrame todas sus etapas"] },
  { id: "service_catalog", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_service_catalog", description: "Catálogo de servicios con descripción y valores de referencia registrados.", examples: ["Lista los servicios", "Catálogo de servicios"] },
  { id: "spare_parts_catalog", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_spare_parts_catalog", description: "Catálogo de repuestos y sus características registradas.", examples: ["Lista los repuestos", "Catálogo de repuestos"] },
  { id: "users_roles", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_users_roles", description: "Usuarios administrativos y roles, sin credenciales.", examples: ["Lista usuarios y roles", "¿Qué usuarios administrativos existen?"] },
  { id: "reminder_list", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_reminder_list", description: "Recordatorios registrados y su relación confirmada con mantenimientos y motocicletas.", examples: ["Lista los recordatorios", "Muéstrame los recordatorios registrados"] },
  { id: "dashboard_summary", audiences: ["admin"], requiresMotorcycle: false, requiredParameters: [], tool: "get_dashboard_summary", description: "Indicadores generales calculados con las definiciones del sistema.", examples: ["Resumen del dashboard", "Indicadores generales"] },
  { id: "approved_documents", audiences: ["client", "admin"], requiresMotorcycle: false, requiredParameters: [], tool: "search_approved_documents", description: "Preguntas sobre manuales, políticas, garantías, reglamentos o procedimientos aprobados. La intención existe aunque la recuperación documental esté desactivada.", examples: ["¿Qué dice el manual sobre garantía?", "Según la política aprobada, ¿qué documentos debo presentar?"] },
];

export type ProposalDisposition =
  | "compatible"
  | "compatible_missing_data"
  | "ambiguous"
  | "unsupported"
  | "greeting"
  | "capabilities"
  | "documental";

export interface IntentProposal {
  disposition: ProposalDisposition;
  capabilityId: CapabilityId | null;
}

const capabilityIds = CHAT_CAPABILITIES.map((item) => item.id);

export const INTENT_PROPOSAL_TOOL: FunctionTool = {
  type: "function",
  name: "propose_chat_intent",
  strict: true,
  description: "Clasifica una solicitud sin responderla. El catálogo ofrece opciones, pero no obliga a elegir una capacidad de negocio cuando el mensaje es ambiguo o está fuera del alcance.",
  parameters: {
    type: "object",
    properties: {
      disposition: {
        type: "string",
        enum: ["compatible", "compatible_missing_data", "ambiguous", "unsupported", "greeting", "capabilities", "documental"],
        description: "compatible: consulta completa; compatible_missing_data: capacidad identificada pero falta un dato; ambiguous: no se identifica la consulta o referencia; unsupported: petición entendida fuera del alcance; documental: pregunta para fuentes aprobadas.",
      },
      capabilityId: {
        anyOf: [{ type: "string", enum: capabilityIds }, { type: "null" }],
        description: "Capacidad identificada para compatible, compatible_missing_data o documental. Debe ser null para ambiguous, unsupported, greeting y capabilities. No elijas una capacidad aproximada solo porque aparece en el catálogo.",
      },
    },
    required: ["disposition", "capabilityId"],
    additionalProperties: false,
  },
};

function parseProposal(value: string): IntentProposal {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TypeError("La propuesta de intención no es válida"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("La propuesta de intención no es válida");
  const record = parsed as Record<string, unknown>;
  const dispositions: ProposalDisposition[] = ["compatible", "compatible_missing_data", "ambiguous", "unsupported", "greeting", "capabilities", "documental"];
  if (!dispositions.includes(record.disposition as ProposalDisposition)) throw new TypeError("La propuesta de intención no es válida");
  if (record.capabilityId !== null && !capabilityIds.includes(record.capabilityId as CapabilityId)) {
    throw new TypeError("La propuesta de intención no es válida");
  }
  return { disposition: record.disposition as ProposalDisposition, capabilityId: record.capabilityId as CapabilityId | null };
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-GT");
}

export function enforceClassificationPolicy(
  message: string,
  proposal: IntentProposal,
  context?: { previousUserMessage: string },
  hasMotorcycle = false,
  audience: ChatAudience = "admin",
): IntentProposal {
  const value = normalized(message);
  const asksAboutDocuments = /\b(manual(?:es)?|documentacion|documentos? aprobados?|politica(?:s)?|garantia(?:s)?|reglamento(?:s)?|procedimiento(?:s)?)\b/.test(value);
  const requestsMutation = /^(?:por favor\s+)?(?:cambia|cambiar|modifica|modificar|actualiza|actualizar|edita|editar|elimina|eliminar|borra|borrar|crea|crear|registra|registrar|restablece|restablecer|desactiva|desactivar)\b/.test(value.trim())
    || /\b(?:quiero|necesito|puedes|podrias)\s+(?:que\s+)?(?:cambies|cambiar|modifiques|modificar|actualices|actualizar|edites|editar|elimines|eliminar|borres|borrar|crees|crear|registres|registrar|restablezcas|restablecer|desactives|desactivar)\b/.test(value);
  const startsAsDocumentQuestion = /^(?:que|cual|cuales|como|segun|consulta|explica|muestra|dime)\b/.test(value.trim());
  const asksCustomerAggregate = /\b(clientes?|personas? registradas?)\b/.test(value)
    && /\b(resumen|cuantos?|cuantas?|cantidad|total|numero)\b/.test(value);
  const asksAboutClients = /\b(clientes?|personas? registradas?)\b/.test(value);
  const hasUnresolvedReference = /\b(eso|esto|aquello|esa|ese|esa consulta|ese tema)\b/.test(value)
    || /^\s*(?:y\s+)?como\s+va\s+(?:todo|eso|esto)?\s*[?.!]*$/.test(value);
  const namesConcreteTopic = /\b(placa(?:s)?|mantenimiento(?:s)?|servicio(?:s)?|manual(?:es)?|politica(?:s)?|garantia(?:s)?|motocicleta(?:s)?|moto(?:s)?)\b/.test(value);
  const mentionsMaintenance = /\b(mantenimiento(?:s)?|servicio(?:s)?)\b/.test(value);
  const asksGeneralMaintenanceSummary = /\b(resumen|total|cuantos?|cuantas?|cantidad)\b/.test(value)
    && /\bmantenimientos?\b/.test(value)
    && !/\b(esta|este|esa|ese|mi|su|una)\s+(?:motocicleta|moto)\b/.test(value);
  const asksMotorcycleHistory = /\bhistorial\b/.test(value)
    || /\bservicios?\s+(?:registrados?\s+)?(?:de|para)\s+(?:esta|este|esa|ese|mi|su|una|la)\s+(?:motocicleta|moto)\b/.test(value);
  const asksPendingPlates = /\b(sin placa|sin matricula|no (?:tienen|cuentan con) (?:placa|matricula)|pendientes? de (?:placa|matricula))\b/.test(value);
  const asksIndividualMotorcycle = /\b(esta|este|esa|ese|mi|su|una|la)\s+(?:motocicleta|moto)\b/.test(value);
  const asksMotorcycleFleetSummary = /\b(resumen|total|cantidad|cuantas?|cuantos?)\b/.test(value)
    && /\b(motocicletas?|motos?)\b/.test(value)
    && !asksPendingPlates
    && !asksIndividualMotorcycle;
  const asksTemporalMotorcycleFleetSummary = asksMotorcycleFleetSummary
    && /\b(hoy|ayer|semana|mes|ano|fecha|periodo|entre|desde|hasta)\b/.test(value);
  const motorcycleTopicWords = value.match(/[a-z0-9]+/g) ?? [];
  const onlyMotorcycleTopic = motorcycleTopicWords.length > 0 && motorcycleTopicWords.every((word) => [
    "moto", "motos", "motocicleta", "motocicletas", "y", "las", "los", "de", "sobre",
  ].includes(word));
  const asksServiceCatalog = /\b(catalogo|lista|servicios disponibles)\b/.test(value) && /\bservicios?\b/.test(value);
  const asksSpareParts = /\b(repuestos?|piezas?)\b/.test(value);
  const asksUsersRoles = /\b(usuarios?|roles?)\b/.test(value);
  const asksReminders = /\brecordatorios?\b/.test(value);
  const asksDashboard = /\b(dashboard|indicadores generales|panel general)\b/.test(value);
  const asksMotorcycleList = /\b(lista|listar|muestra|mostrar)\b/.test(value) && /\b(motocicletas?|motos?)\b/.test(value) && !asksIndividualMotorcycle;
  const asksPlateHistory = /\b(historial|todas las etapas|etapas registradas)\b/.test(value) && /\b(placa|placas|tramite)\b/.test(value);

  if (asksAboutDocuments && (!requestsMutation || startsAsDocumentQuestion)) return { disposition: "documental", capabilityId: "approved_documents" };
  const asksCustomerSearch = /\b(busca|buscar|encuentra|encontrar|muestra|detalle|informacion)\b/.test(value) && asksAboutClients;
  const asksCustomerDetail = asksAboutClients && /\bnit\b/.test(value)
    && /\b(detalle|informacion completa|motos tiene|motocicletas tiene|asociadas)\b/.test(value);
  if (requestsMutation || (audience === "client" && asksAboutClients)) return { disposition: "unsupported", capabilityId: null };
  if (audience === "admin" && (asksCustomerAggregate
    || (asksAboutClients && proposal.disposition === "compatible" && proposal.capabilityId === "customer_summary"))) {
    return { disposition: "compatible", capabilityId: "customer_summary" };
  }
  if (audience === "admin" && asksCustomerDetail) return { disposition: "compatible", capabilityId: "customer_detail" };
  if (audience === "admin" && asksCustomerSearch) return { disposition: "compatible", capabilityId: "customer_search" };
  if (audience === "admin" && asksAboutClients) return { disposition: "ambiguous", capabilityId: null };
  if (audience === "admin" && asksServiceCatalog) return { disposition: "compatible", capabilityId: "service_catalog" };
  if (audience === "admin" && asksSpareParts) return { disposition: "compatible", capabilityId: "spare_parts_catalog" };
  if (audience === "admin" && asksUsersRoles) return { disposition: "compatible", capabilityId: "users_roles" };
  if (audience === "admin" && asksReminders) return { disposition: "compatible", capabilityId: "reminder_list" };
  if (audience === "admin" && asksDashboard) return { disposition: "compatible", capabilityId: "dashboard_summary" };
  if (audience === "admin" && asksPlateHistory) return { disposition: hasMotorcycle ? "compatible" : "compatible_missing_data", capabilityId: "plate_history" };
  if (audience === "admin" && asksMotorcycleList) return { disposition: "compatible", capabilityId: "motorcycle_list" };
  if (onlyMotorcycleTopic) return { disposition: "ambiguous", capabilityId: null };
  if (asksTemporalMotorcycleFleetSummary) return { disposition: "unsupported", capabilityId: null };
  if (asksMotorcycleFleetSummary) return { disposition: "compatible", capabilityId: "motorcycle_fleet_summary" };
  if (!hasMotorcycle && asksGeneralMaintenanceSummary) return { disposition: "compatible_missing_data", capabilityId: "maintenance_period_summary" };
  if (!hasMotorcycle && asksMotorcycleHistory) return { disposition: "compatible_missing_data", capabilityId: "maintenance_history" };
  if (!hasMotorcycle && mentionsMaintenance && proposal.disposition === "ambiguous") return { disposition: "ambiguous", capabilityId: null };
  if (!context && hasUnresolvedReference && !namesConcreteTopic) return { disposition: "ambiguous", capabilityId: null };
  if (proposal.disposition === "ambiguous" || proposal.disposition === "unsupported"
    || proposal.disposition === "greeting" || proposal.disposition === "capabilities") {
    return { ...proposal, capabilityId: null };
  }
  return proposal;
}

export interface IntentSelector {
  select(
    message: string,
    audience: ChatAudience,
    hasMotorcycle: boolean,
    context?: { previousUserMessage: string },
  ): Promise<IntentProposal>;
}

export interface IntentSelectionUsage {
  responseCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface IntentSelectionTrace {
  modelProposal: IntentProposal;
  finalProposal: IntentProposal;
  correctionApplied: boolean;
}

export function createModelIntentSelector(
  model: ChatModelGateway,
  onUsage?: (usage: IntentSelectionUsage) => void,
  onTrace?: (trace: IntentSelectionTrace) => void,
): IntentSelector {
  return {
    async select(message, audience, hasMotorcycle, context) {
      let proposal: IntentProposal | null = null;
      const available = CHAT_CAPABILITIES.filter((item) => item.audiences.includes(audience));
      const result = await model.generate({
        instructions: [
          "Clasifica la solicitud sin responderla ni inventar parámetros.",
          "El historial no es evidencia y no se incluye en esta clasificación.",
          "El catálogo son opciones posibles, no una obligación de elegir la opción más parecida.",
          "Usa compatible solo cuando una capacidad autorizada coincide con una solicitud completa.",
          "Usa compatible_missing_data cuando identificas una capacidad autorizada concreta, pero falta un parámetro requerido o seleccionar la motocicleta. Conserva esa capabilityId.",
          "Usa ambiguous con capabilityId null cuando no se puede identificar una consulta concreta o una referencia no tiene contexto, por ejemplo ‘¿Cómo va eso?’. No adivines placas ni mantenimientos.",
          "Usa unsupported cuando la solicitud se entiende, pero ninguna capacidad autorizada para esa audiencia puede resolverla; aportar más datos no la volvería posible. Ejemplos: cambiar contraseñas, editar registros, crear o eliminar información o consultar configuración no almacenada.",
          "Usa documental con approved_documents para preguntas sobre manuales, políticas, garantías, reglamentos o procedimientos aprobados. Clasifica la intención documental sin considerar si RAG está encendido; la disponibilidad se comprueba después.",
          "Las palabras cambio o mantenimiento dentro de una pregunta documental no son una solicitud de escritura. Distingue ‘actualiza el mantenimiento’ de ‘cuál es la próxima fecha registrada’ y de ‘qué dice el manual sobre el cambio de aceite’.",
          "No uses compatible_missing_data para una función inexistente: si seguirá sin estar disponible aunque el usuario dé más información, usa unsupported.",
          "Usa greeting para saludos y capabilities cuando pregunta qué consultas puede realizar.",
          `Audiencia: ${audience}. Motocicleta seleccionada: ${hasMotorcycle ? "sí" : "no"}.`,
          context
            ? `Solicitud anterior del usuario pendiente de parámetros: ${JSON.stringify(context.previousUserMessage)}. Úsala solo para completar la intención; los parámetros deben proceder del mensaje actual.`
            : "No hay una solicitud anterior pendiente.",
          `Catálogo permitido: ${JSON.stringify(available.map(({ id, requiresMotorcycle, requiredParameters, description, examples }) => ({ id, requiresMotorcycle, requiredParameters, availableNow: !requiresMotorcycle || hasMotorcycle, description, examples })))}`,
        ].join("\n"),
        message,
        history: [],
        tools: [INTENT_PROPOSAL_TOOL],
      }, async (call) => {
        if (call.name !== INTENT_PROPOSAL_TOOL.name) throw new TypeError("La propuesta usa una herramienta no permitida");
        proposal = parseProposal(call.arguments);
        return { modelData: proposal, deterministicText: "Clasificación completada" };
      });
      if (typeof result !== "string" && result.usage !== null) {
        const usage = {
          responseCalls: result.responseCalls,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        };
        onUsage?.(usage);
        console.info(JSON.stringify({ event: "chatbot_openai_usage", scope: audience, ...usage }));
      }
      if (proposal === null) throw new TypeError("No fue posible clasificar la solicitud");
      const modelProposal: IntentProposal = proposal;
      const finalProposal = enforceClassificationPolicy(message, modelProposal, context, hasMotorcycle, audience);
      const trace = {
        modelProposal,
        finalProposal,
        correctionApplied: modelProposal.disposition !== finalProposal.disposition
          || modelProposal.capabilityId !== finalProposal.capabilityId,
      };
      onTrace?.(trace);
      console.info(JSON.stringify({ event: "chatbot_intent_trace", audience, ...trace }));
      return finalProposal;
    },
  };
}

export interface ValidatedCapability {
  capability: ChatCapability;
  parameters: Record<string, string | number>;
  interpretedPeriod: string | null;
}

export type ProposalValidation =
  | { status: "valid"; value: ValidatedCapability }
  | {
      status: "clarification";
      reason: "missing_motorcycle" | "missing_date_range" | "ambiguous_scope" | "ambiguous_motorcycle_scope" | "ambiguous_request";
      requestedData: "motorcycle" | "date_range" | "maintenance_scope" | "motorcycle_scope" | "request_details";
      message: string;
    }
  | { status: "unsupported"; message: string };

function dateInGuatemala(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0)).toISOString().slice(0, 10) === value;
}

export function resolveGroundedDateRange(message: string, now = new Date()): { startDate: string; endDate: string; label: string } | null {
  const explicit = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (explicit.length === 2 && validIsoDate(explicit[0]!) && validIsoDate(explicit[1]!) && explicit[0]! <= explicit[1]!) {
    return { startDate: explicit[0]!, endDate: explicit[1]!, label: `${explicit[0]} a ${explicit[1]}` };
  }
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const months: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const written = normalized.match(/\b(?:del|de)\s+(\d{1,2})\s+al\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (written) {
    const startDay = Number(written[1]);
    const endDay = Number(written[2]);
    const month = months[written[3] ?? ""];
    const writtenYear = Number(written[4]);
    if (month && startDay <= endDay) {
      const startDate = `${writtenYear}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
      const endDate = `${writtenYear}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
      if (validIsoDate(startDate) && validIsoDate(endDate)) return { startDate, endDate, label: `${startDate} a ${endDate}` };
    }
  }
  const todayText = dateInGuatemala(now);
  const [year, month, day] = todayText.split("-").map(Number);
  if (!year || !month || !day) return null;
  if (/\bhoy\b/.test(normalized)) return { startDate: todayText, endDate: todayText, label: `${todayText} (hoy)` };
  if (/\b(este mes|mes actual)\b/.test(normalized)) {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    return { startDate, endDate: todayText, label: `${startDate} a ${todayText} (mes actual)` };
  }
  if (/\b(mes pasado|ultimo mes)\b/.test(normalized)) {
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    return { startDate, endDate, label: `${startDate} a ${endDate} (mes anterior)` };
  }
  return null;
}

export function validateIntentProposal(
  proposal: IntentProposal,
  audience: ChatAudience,
  hasMotorcycle: boolean,
  message: string,
  now = new Date(),
): ProposalValidation {
  const normalizedMessage = normalized(message);
  if (proposal.disposition !== "compatible" && proposal.disposition !== "compatible_missing_data" && proposal.disposition !== "documental") {
    const motorcycleWords = normalizedMessage.match(/[a-z0-9]+/g) ?? [];
    const onlyMotorcycleTopic = motorcycleWords.length > 0 && motorcycleWords.every((word) => [
      "moto", "motos", "motocicleta", "motocicletas", "y", "las", "los", "de", "sobre",
    ].includes(word));
    if (proposal.disposition === "ambiguous" && onlyMotorcycleTopic) {
      return {
        status: "clarification",
        reason: "ambiguous_motorcycle_scope",
        requestedData: "motorcycle_scope",
        message: "¿Deseas el resumen general de motocicletas o consultar una motocicleta por placa o factura?",
      };
    }
    if (proposal.disposition === "ambiguous" && /\b(clientes?|personas? registradas?)\b/.test(normalizedMessage)) {
      return { status: "clarification", reason: "ambiguous_request", requestedData: "request_details", message: "¿Deseas un resumen de clientes, buscar un cliente o consultar su detalle y motocicletas por NIT?" };
    }
    return proposal.disposition === "ambiguous" && /\b(mantenimiento(?:s)?|servicio(?:s)?)\b/.test(normalizedMessage)
      ? { status: "clarification", reason: "ambiguous_scope", requestedData: "maintenance_scope", message: "¿Deseas un resumen general de mantenimientos o el historial de una motocicleta?" }
      : proposal.disposition === "ambiguous"
        ? { status: "clarification", reason: "ambiguous_request", requestedData: "request_details", message: "Indica si deseas consultar el resumen general de motocicletas, motocicletas sin placa, un resumen de mantenimientos por período o los datos de una motocicleta seleccionada." }
      : { status: "unsupported", message: "Esa consulta no está disponible con las opciones actuales." };
  }
  if (proposal.capabilityId === null) return { status: "clarification", reason: "ambiguous_request", requestedData: "request_details", message: "Indica qué información deseas consultar." };
  const capability = CHAT_CAPABILITIES.find((item) => item.id === proposal.capabilityId);
  if (!capability || !capability.audiences.includes(audience)) return { status: "unsupported", message: "Esa consulta no está disponible para este acceso." };
  if ((proposal.disposition === "documental") !== (capability.id === "approved_documents")) {
    return { status: "unsupported", message: "La intención propuesta no corresponde con la consulta disponible." };
  }
  if (capability.requiresMotorcycle && !hasMotorcycle) {
    return { status: "clarification", reason: "missing_motorcycle", requestedData: "motorcycle", message: "Selecciona una motocicleta por placa o por serie y número de factura antes de consultar." };
  }
  if (capability.id === "maintenance_period_summary") {
    const range = resolveGroundedDateRange(message, now);
    if (!range) return { status: "clarification", reason: "missing_date_range", requestedData: "date_range", message: "Indica la fecha inicial y final del período, por ejemplo: 2026-09-01 a 2026-09-30." };
    return { status: "valid", value: { capability, parameters: { startDate: range.startDate, endDate: range.endDate }, interpretedPeriod: range.label } };
  }
  if (capability.requiredParameters.includes("searchTerm")) {
    const quoted = message.match(/["“]([^"”]{1,120})["”]/)?.[1]?.trim();
    const labeled = message.match(/\b(?:nit|dpi|tel[eé]fono|correo|email)\s*(?:es|:|n[uú]mero)?\s*([a-z0-9@._-]{2,120})/i)?.[1]?.trim();
    const named = message.match(/\bclientes?\s+(?:(?:llamad[oa]s?|de\s+nombre|con\s+nombre)\s+)?([\p{L}][\p{L}\s'-]{1,80})/iu)?.[1]
      ?.replace(/\b(?:con|que|por|cuyo|cuya|del|de\s+la)\b.*$/iu, "").trim();
    const afterSearchVerb = message.match(/\b(?:busca|buscar|encuentra|encontrar)\s+(?:a\s+)?([\p{L}][\p{L}\s'-]{1,80})/iu)?.[1]
      ?.replace(/^clientes?\s+(?:(?:llamad[oa]s?|de\s+nombre|con\s+nombre)\s+)?/iu, "")
      .replace(/\b(?:con|que|por|cuyo|cuya|del|de\s+la)\b.*$/iu, "").trim();
    const query = quoted || labeled || named || afterSearchVerb;
    if (!query) return { status: "clarification", reason: "ambiguous_request", requestedData: "request_details", message: capability.id === "customer_detail" ? "Indica el NIT del cliente que deseas consultar." : "Indica el nombre, DPI, NIT, teléfono o correo del cliente que deseas buscar." };
    return { status: "valid", value: { capability, parameters: { query, page: 1, pageSize: 10 }, interpretedPeriod: null } };
  }
  const parameters = ["pending_plates", "maintenance_history", "motorcycle_overview", "motorcycle_list", "service_catalog", "spare_parts_catalog", "users_roles", "reminder_list"].includes(capability.id)
    ? { page: 1, pageSize: 20 }
    : {};
  return { status: "valid", value: { capability, parameters, interpretedPeriod: null } };
}

export function capabilitiesMessage(audience: ChatAudience, hasMotorcycle: boolean, ragEnabled = false): string {
  const available = CHAT_CAPABILITIES.filter((item) => item.audiences.includes(audience)
    && (!item.requiresMotorcycle || hasMotorcycle)
    && (item.id !== "approved_documents" || ragEnabled));
  return `Consultas disponibles:\n${available.map((item) => `- ${item.description}`).join("\n")}`;
}
