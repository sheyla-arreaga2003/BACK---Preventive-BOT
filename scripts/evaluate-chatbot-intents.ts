import "dotenv/config";
import { createModelIntentSelector, validateIntentProposal, type ChatAudience, type CapabilityId } from "../src/services/chatbot-capabilities.service.js";
import { openAIChatModelGateway } from "../src/services/chatbot-model.service.js";
import { isUnsupportedMotorcycleLookup } from "../src/services/chatbot.service.js";

interface Case {
  label: string;
  message: string;
  audience: ChatAudience;
  hasMotorcycle: boolean;
  expected: CapabilityId | "unsupported" | "clarification" | "clarification_then_maintenance_period_summary";
  previousUserMessage?: string;
  mode?: "backend_guard" | "multi_turn";
  fixtureMotorcycle?: string;
}

const evaluation: Case[] = [
  { label: "nit", message: "Busca la motocicleta asociada al NIT 123456", audience: "admin", hasMotorcycle: false, expected: "unsupported", mode: "backend_guard" },
  { label: "clientes", message: "¿Cuántos clientes existen?", audience: "admin", hasMotorcycle: false, expected: "unsupported" },
  { label: "placas paráfrasis", message: "¿Qué motos siguen sin matrícula?", audience: "admin", hasMotorcycle: false, expected: "pending_plates" },
  { label: "placas error", message: "lista las motod sin plaka", audience: "admin", hasMotorcycle: false, expected: "pending_plates" },
  { label: "fechas faltantes", message: "Resume los mantenimientos", audience: "admin", hasMotorcycle: false, expected: "clarification" },
  { label: "aclaración multivuelta", message: "Del 1 al 28 de septiembre de 2026", previousUserMessage: "Resume los mantenimientos", audience: "admin", hasMotorcycle: false, expected: "clarification_then_maintenance_period_summary", mode: "multi_turn" },
  { label: "combinada", message: "Quiero ver placas y mantenimientos", audience: "client", hasMotorcycle: true, expected: "motorcycle_overview", fixtureMotorcycle: "eval-motorcycle-001" },
  { label: "documental", message: "¿Qué dice el manual aprobado sobre garantía?", audience: "client", hasMotorcycle: true, expected: "approved_documents" },
  { label: "fuera alcance", message: "Cambia la contraseña del usuario", audience: "admin", hasMotorcycle: false, expected: "unsupported" },
  { label: "ambigua", message: "¿Cómo va eso?", audience: "admin", hasMotorcycle: false, expected: "clarification" },
];

if (process.env.CHATBOT_EVAL_CONFIRM_REAL !== "true") {
  throw new Error("Evaluación real bloqueada: establece CHATBOT_EVAL_CONFIRM_REAL=true para autorizar hasta 10 solicitudes.");
}
if (process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true") {
  throw new Error("Evaluación bloqueada: CHATBOT_RAG_ENABLED debe permanecer desactivado.");
}
if (evaluation.length !== 10) throw new Error("La evaluación debe contener exactamente 10 escenarios.");
const combined = evaluation.find((entry) => entry.label === "combinada");
if (!combined?.hasMotorcycle || combined.fixtureMotorcycle !== "eval-motorcycle-001") {
  throw new Error("El escenario combinado requiere una motocicleta ficticia autorizada.");
}
const ambiguous = evaluation.find((entry) => entry.label === "ambigua");
if (ambiguous?.previousUserMessage !== undefined) throw new Error("El escenario ambiguo debe ejecutarse sin contexto previo.");
const contexts = evaluation.filter((entry) => entry.previousUserMessage !== undefined);
if (contexts.length !== 1 || contexts[0]?.label !== "aclaración multivuelta") {
  throw new Error("El contexto multivuelta debe estar aislado de los demás escenarios.");
}

const totals = { responseCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const selector = createModelIntentSelector(openAIChatModelGateway, (usage) => {
  totals.responseCalls += usage.responseCalls;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.totalTokens += usage.totalTokens;
});
let failures = 0;
let openAICalls = 0;
async function selectOnce(
  entry: Case,
  message: string,
  previousUserMessage?: string,
) {
  if (openAICalls >= 10) throw new Error("Se alcanzó el máximo de 10 solicitudes reales.");
  const result = await selector.select(
    message,
    entry.audience,
    entry.hasMotorcycle,
    previousUserMessage ? { previousUserMessage } : undefined,
  );
  openAICalls += 1;
  return result;
}
for (const entry of evaluation) {
  if (entry.mode === "backend_guard") {
    const actual = isUnsupportedMotorcycleLookup(entry.message) ? "unsupported" : "guard_failed";
    const passed = actual === entry.expected;
    if (!passed) failures += 1;
    console.info(JSON.stringify({ label: entry.label, expected: entry.expected, actual, passed }));
    continue;
  }
  let firstTurn: string | null = null;
  if (entry.mode === "multi_turn" && entry.previousUserMessage) {
    const firstProposal = await selectOnce(entry, entry.previousUserMessage);
    const firstValidation = validateIntentProposal(firstProposal, entry.audience, entry.hasMotorcycle, entry.previousUserMessage);
    firstTurn = firstValidation.status === "valid" ? firstValidation.value.capability.id : firstValidation.status;
  }
  const proposal = await selectOnce(entry, entry.message, entry.previousUserMessage);
  const validation = validateIntentProposal(proposal, entry.audience, entry.hasMotorcycle, entry.message);
  const secondTurn = validation.status === "valid" ? validation.value.capability.id : validation.status;
  const actual = entry.mode === "multi_turn" ? `${firstTurn}_then_${secondTurn}` : secondTurn;
  const passed = actual === entry.expected;
  if (!passed) failures += 1;
  console.info(JSON.stringify({ label: entry.label, expected: entry.expected, actual, passed }));
}
console.info(JSON.stringify({ scenarios: evaluation.length, openAICalls, maximumOpenAICalls: 10, failures, usage: totals }));
if (failures > 0) process.exitCode = 1;
