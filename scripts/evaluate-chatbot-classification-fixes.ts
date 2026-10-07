import "dotenv/config";
import {
  createModelIntentSelector,
  validateIntentProposal,
  type CapabilityId,
  type IntentSelectionUsage,
  type IntentSelectionTrace,
} from "../src/services/chatbot-capabilities.service.js";
import { openAIChatModelGateway } from "../src/services/chatbot-model.service.js";

interface EvaluationCase {
  label: string;
  message: string;
  hasMotorcycle: boolean;
  expected: CapabilityId | "unsupported" | "clarification";
  expectedClarificationReason?: "missing_motorcycle" | "missing_date_range" | "ambiguous_scope" | "ambiguous_request";
}

export const FOCUSED_CLASSIFICATION_CASES: readonly EvaluationCase[] = [
  { label: "fuera de alcance", message: "Necesito saber el número total de usuarios registrados", hasMotorcycle: false, expected: "unsupported" },
  { label: "escritura", message: "¿Podrías modificar el teléfono de un cliente?", hasMotorcycle: false, expected: "unsupported" },
  { label: "lectura con negación", message: "Sin actualizar nada, dime la próxima fecha registrada de mantenimiento", hasMotorcycle: true, expected: "next_maintenance" },
  { label: "documental con cambio", message: "¿Qué señala el reglamento acerca del cambio de aceite?", hasMotorcycle: false, expected: "approved_documents" },
  { label: "referencia ambigua", message: "¿Y aquello cómo quedó?", hasMotorcycle: false, expected: "clarification", expectedClarificationReason: "ambiguous_request" },
  { label: "individual sin selección", message: "Muéstrame los servicios registrados de la motocicleta", hasMotorcycle: false, expected: "clarification", expectedClarificationReason: "missing_motorcycle" },
  { label: "período faltante", message: "Dame un resumen de los mantenimientos", hasMotorcycle: false, expected: "clarification", expectedClarificationReason: "missing_date_range" },
  { label: "placas pendientes", message: "¿Cuántas motos siguen esperando matrícula?", hasMotorcycle: false, expected: "pending_plates" },
];

if (process.env.CHATBOT_CLASSIFICATION_EVAL_CONFIRM_REAL !== "true") {
  throw new Error("Evaluación real bloqueada: establece CHATBOT_CLASSIFICATION_EVAL_CONFIRM_REAL=true para autorizar hasta 8 solicitudes.");
}
if (process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true") {
  throw new Error("Evaluación bloqueada: CHATBOT_RAG_ENABLED debe permanecer desactivado.");
}
if (FOCUSED_CLASSIFICATION_CASES.length !== 8) throw new Error("La evaluación focalizada debe contener exactamente 8 escenarios.");

const totals: IntentSelectionUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const traces: IntentSelectionTrace[] = [];
const selector = createModelIntentSelector(openAIChatModelGateway, (usage) => {
  totals.responseCalls += usage.responseCalls;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.totalTokens += usage.totalTokens;
}, (trace) => {
  traces.push(trace);
});
let openAICalls = 0;
let failures = 0;
for (const entry of FOCUSED_CLASSIFICATION_CASES) {
  if (openAICalls >= 8) throw new Error("Se alcanzó el máximo de 8 solicitudes reales.");
  traces.length = 0;
  const proposal = await selector.select(entry.message, "admin", entry.hasMotorcycle);
  openAICalls += 1;
  const trace = traces.shift();
  if (!trace) throw new Error(`No se registró la trazabilidad del escenario: ${entry.label}`);
  const validation = validateIntentProposal(proposal, "admin", entry.hasMotorcycle, entry.message);
  const actual = validation.status === "valid" ? validation.value.capability.id : validation.status;
  const clarificationReason = validation.status === "clarification" ? validation.reason : null;
  const requestedData = validation.status === "clarification" ? validation.requestedData : null;
  const passed = actual === entry.expected
    && (entry.expectedClarificationReason === undefined || clarificationReason === entry.expectedClarificationReason);
  if (!passed) failures += 1;
  console.info(JSON.stringify({
    label: entry.label,
    expected: entry.expected,
    modelProposal: trace.modelProposal,
    finalProposal: trace.finalProposal,
    correctionApplied: trace.correctionApplied,
    actual,
    clarificationReason,
    requestedData,
    passed,
  }));
}
console.info(JSON.stringify({ scenarios: FOCUSED_CLASSIFICATION_CASES.length, openAICalls, maximumOpenAICalls: 8, failures, usage: totals }));
if (failures > 0) process.exitCode = 1;
