import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { createClient } from "redis";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: process.env.CHATBOT_TEST_ENV_FILE?.trim() || ".env.chatbot-test.local", override: true, quiet: true });

interface DbRow extends RowDataPacket { databaseName: string }
interface Trace { modelProposal: unknown; finalProposal: unknown; correctionApplied: boolean }
interface Diagnostic { intent: string; tool: string | null; validation: string; result: string }
interface Usage { responseCalls: number; inputTokens: number; outputTokens: number; totalTokens: number }
interface ScenarioResult { name: string; expected: string[]; response: string; trace: Trace | null; diagnostic: Diagnostic | null; passed: boolean; error?: string }

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}`);
  return value;
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const normalized = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

if (required("CHATBOT_INTEGRATION_CONFIRM_FIXTURES") !== "true" || required("NODE_ENV") !== "test") throw new Error("Evaluación bloqueada: se requieren fixtures y NODE_ENV=test");
if (required("DB_NAME") !== "preventive_bot_chatbot_test") throw new Error("Evaluación bloqueada: base aislada incorrecta");
if (required("REDIS_KEY_PREFIX") !== "preventive-bot:test:chatbot:" || required("CHATBOT_TEST_ALLOW_EXISTING_REDIS") !== "true") throw new Error("Evaluación bloqueada: prefijo Redis incorrecto");
if (process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true") throw new Error("Evaluación bloqueada: RAG debe estar desactivado");
if (required("CHATBOT_ADMIN_EVAL_CONFIRM_REAL") !== "true") throw new Error("Evaluación real no autorizada");

const port = Number(required("PORT"));
const baseUrl = `http://127.0.0.1:${port}`;
const redisPrefix = required("REDIS_KEY_PREFIX");
const database = await mysql.createConnection({ host: required("DB_HOST"), port: Number(required("DB_PORT")), user: required("DB_USER"), password: required("DB_PASSWORD"), database: required("DB_NAME") });
const redis = createClient({ url: required("REDIS_URL"), socket: { connectTimeout: 3_000, reconnectStrategy: false } });
redis.on("error", () => undefined);
let server: ChildProcess | null = null;
let buffered = "";
const traces: Trace[] = [];
const diagnostics: Diagnostic[] = [];
const usage: Usage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const results: ScenarioResult[] = [];

function parseLog(line: string): void {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return; }
  if (!record(value)) return;
  if (value.event === "chatbot_intent_trace" && record(value.modelProposal) && record(value.finalProposal) && typeof value.correctionApplied === "boolean") {
    traces.push({ modelProposal: value.modelProposal, finalProposal: value.finalProposal, correctionApplied: value.correctionApplied });
  }
  if (value.event === "chatbot_query_diagnostic" && typeof value.intent === "string" && (typeof value.tool === "string" || value.tool === null) && typeof value.validation === "string" && typeof value.result === "string") {
    diagnostics.push({ intent: value.intent, tool: value.tool, validation: value.validation, result: value.result });
  }
  if (value.event === "chatbot_openai_usage") {
    for (const key of ["responseCalls", "inputTokens", "outputTokens", "totalTokens"] as const) if (typeof value[key] === "number") usage[key] += value[key];
  }
}

async function cleanRedis(): Promise<void> {
  for await (const keys of redis.scanIterator({ MATCH: `${redisPrefix}*`, COUNT: 100 })) for (const key of keys) await redis.del(key);
}
async function waitServer(): Promise<void> {
  for (let count = 0; count < 40; count += 1) {
    if (server?.exitCode !== null) throw new Error("El servidor aislado terminó durante el inicio");
    try { if ((await fetch(`${baseUrl}/`)).ok) return; } catch { /* continúa */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor aislado no inició a tiempo");
}
async function chat(token: string, message: string, conversationId: string, history: Array<{ role: "user" | "assistant"; content: string }> = [], target?: object): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chatbot/admin/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ message, history, conversationId, ...(target ? { target } : {}) }) });
  const value: unknown = await response.json();
  if (response.status !== 200 || !record(value) || typeof value.message !== "string") throw new Error(`Respuesta HTTP inesperada: ${response.status}`);
  return value.message;
}
async function scenario(name: string, expected: string[], operation: () => Promise<string>): Promise<string> {
  const traceStart = traces.length;
  const diagnosticStart = diagnostics.length;
  try {
    const response = await operation();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    if (usage.responseCalls > 12) throw new Error("Se excedió el máximo de 12 llamadas");
    const text = normalized(response);
    const passed = expected.every((item) => text.includes(normalized(item)));
    results.push({ name, expected, response, trace: traces[traceStart] ?? null, diagnostic: diagnostics[diagnosticStart] ?? null, passed, ...(passed ? {} : { error: "La respuesta no contiene toda la evidencia esperada" }) });
    return response;
  } catch (error: unknown) {
    results.push({ name, expected, response: "", trace: traces[traceStart] ?? null, diagnostic: diagnostics[diagnosticStart] ?? null, passed: false, error: error instanceof Error ? error.message : "Fallo desconocido" });
    return "";
  }
}

try {
  const [dbRows] = await database.query<DbRow[]>("SELECT DATABASE() databaseName");
  if (dbRows[0]?.databaseName !== "preventive_bot_chatbot_test") throw new Error("La conexión no usa la base aislada esperada");
  await redis.connect();
  await cleanRedis();
  const sid = crypto.randomUUID();
  await redis.set(`${redisPrefix}session:${sid}`, JSON.stringify({ userId: 9001, email: "admin.chatbot@example.invalid" }), { EX: 1800 });
  const token = jwt.sign({ sub: 9001, sid }, required("JWT_SECRET"), { expiresIn: 1800 });
  server = spawn(process.execPath, ["--import", "tsx", "src/app.ts"], { cwd: process.cwd(), env: { ...process.env, CHATBOT_RAG_ENABLED: "false" }, stdio: ["ignore", "pipe", "ignore"] });
  server.stdout?.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) parseLog(line);
  });
  await waitServer();
  const cid = (suffix: string) => `eval_admin_${suffix.padEnd(12, "0")}`;
  await scenario("Resumen de clientes", ["Total registrado: 3", "Activos: 2", "Inactivos: 1"], () => chat(token, "Dame un resumen de clientes", cid("clients")));
  await scenario("Búsqueda ambigua, selección numerada y motocicletas", ["Ana Primera", "Ana Segunda", "Responde con el número", "Modelo Dos"], async () => {
    const searchAnswer = await chat(token, "Busca clientes llamados Ana", cid("customerpick"));
    const detailAnswer = await chat(token, "2", cid("customerpick"), [{ role: "user", content: "Busca clientes llamados Ana" }, { role: "assistant", content: searchAnswer }]);
    return `${searchAnswer}\n\n${detailAnswer}`;
  });
  await scenario("Resumen de motocicletas", ["Total registrado: 2", "Con placa registrada: 0", "Sin placa registrada: 2"], () => chat(token, "Dame un resumen general de motocicletas", cid("motos")));
  let clarification = "";
  clarification = await scenario("Resumen de mantenimientos solicita período", ["fecha inicial y final"], () => chat(token, "Dame un resumen de los mantenimientos", cid("maintenance")));
  const monthAnswer = await scenario("Mes pasado completa la aclaración", ["1 de septiembre de 2026", "30 de septiembre de 2026", "Mantenimientos registrados: 1"], () => chat(token, "mes pasado", cid("maintenance"), [{ role: "user", content: "Dame un resumen de los mantenimientos" }, { role: "assistant", content: clarification }]));
  await scenario("Cambio de tema no arrastra período", ["Total registrado: 3", "Activos: 2"], () => chat(token, "¿y clientes?", cid("maintenance"), [{ role: "user", content: "mes pasado" }, { role: "assistant", content: monthAnswer }]));
  await scenario("Catálogo de servicios", ["Servicio ficticio", "Descripción ficticia"], () => chat(token, "Muéstrame el catálogo de servicios", cid("services")));
  await scenario("Catálogo de repuestos", ["Filtro ficticio", "Marca repuesto"], () => chat(token, "Lista los repuestos registrados", cid("parts")));
  await scenario("Usuarios y roles", ["Ada Prueba", "Admin"], () => chat(token, "Lista usuarios y roles", cid("users")));
  await scenario("Recordatorios", ["Recordatorio ficticio", "Marca Ficticia Modelo Uno"], () => chat(token, "Muéstrame los recordatorios registrados", cid("reminders")));
  await scenario("Dashboard", ["Clientes registrados: 3", "Motocicletas registradas: 2"], () => chat(token, "Dame el resumen del dashboard", cid("dashboard")));
  await scenario("Historial de placas individual", ["Verificación de NIT", "Solicitud primeras placas"], () => chat(token, "Muéstrame el historial de placas de esta motocicleta", cid("platehistory"), [], { type: "invoice", serieInvoice: required("CHATBOT_TEST_INVOICE_SERIES"), numberInvoice: required("CHATBOT_TEST_INVOICE_NUMBER") }));
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  if (buffered.trim()) parseLog(buffered.trim());
  if (redis.isOpen) await cleanRedis();
  if (redis.isOpen) await redis.quit();
  await database.end();
}

const direct = results.filter((item) => item.passed && item.trace && !item.trace.correctionApplied).length;
const corrected = results.filter((item) => item.passed && item.trace?.correctionApplied).length;
for (const result of results) console.log(JSON.stringify(result));
console.log(JSON.stringify({ scenarios: results.length, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).length, directModelSuccesses: direct, backendCorrectedSuccesses: corrected, calls: usage.responseCalls, usage }));
if (results.length !== 12 || results.some((item) => !item.passed) || usage.responseCalls > 12) process.exitCode = 1;
