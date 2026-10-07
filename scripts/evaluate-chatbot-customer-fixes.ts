import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { createClient } from "redis";

const MAX_HTTP_TURNS = 8;
const MAX_OPENAI_CALLS = 8;
const EXPECTED_OPENAI_CALLS = 5;

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: process.env.CHATBOT_TEST_ENV_FILE?.trim() || ".env.chatbot-test.local", override: true, quiet: true });

interface DatabaseRow extends RowDataPacket { databaseName: string }
interface FixtureCustomerRow extends RowDataPacket { CUIdCustomer: number; CUNIT: string }
interface FixtureMotorcycleRow extends RowDataPacket { CUIdCustomer: number; MOModel: string }
interface Trace {
  modelProposal: { disposition?: unknown; capabilityId?: unknown };
  finalProposal: { disposition?: unknown; capabilityId?: unknown };
  correctionApplied: boolean;
}
interface Diagnostic { intent: string; tool: string | null; validation: string; result: string }
interface Usage { responseCalls: number; inputTokens: number; outputTokens: number; totalTokens: number }
interface TurnResult { message: string; trace: Trace | null; diagnostic: Diagnostic | null }
interface ScenarioResult {
  name: string;
  expected: readonly string[];
  turns: TurnResult[];
  passed: boolean;
  reason: string | null;
}

function requireVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-GT");
}

if (requireVariable("CHATBOT_CUSTOMER_FIX_EVAL_CONFIRM_REAL") !== "true") {
  throw new Error(`Evaluación bloqueada: confirma expresamente hasta ${MAX_OPENAI_CALLS} solicitudes reales`);
}
if (requireVariable("NODE_ENV") !== "test" || requireVariable("CHATBOT_INTEGRATION_CONFIRM_FIXTURES") !== "true") {
  throw new Error("Evaluación bloqueada: se requiere NODE_ENV=test y confirmación de fixtures");
}
if (requireVariable("DB_NAME") !== "preventive_bot_chatbot_test") {
  throw new Error("Evaluación bloqueada: la base no es preventive_bot_chatbot_test");
}
const redisPrefix = requireVariable("REDIS_KEY_PREFIX");
if (redisPrefix !== "preventive-bot:test:chatbot:" || requireVariable("CHATBOT_TEST_ALLOW_EXISTING_REDIS") !== "true") {
  throw new Error("Evaluación bloqueada: Redis no tiene el prefijo aislado esperado");
}
if (process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true") {
  throw new Error("Evaluación bloqueada: RAG debe permanecer desactivado");
}

const port = Number(requireVariable("PORT"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Puerto de prueba inválido");
const baseUrl = `http://127.0.0.1:${port}`;
const database = await mysql.createConnection({
  host: requireVariable("DB_HOST"), port: Number(requireVariable("DB_PORT")), user: requireVariable("DB_USER"),
  password: requireVariable("DB_PASSWORD"), database: requireVariable("DB_NAME"),
});
const redis = createClient({ url: requireVariable("REDIS_URL"), socket: { connectTimeout: 3_000, reconnectStrategy: false } });
redis.on("error", () => undefined);

let server: ChildProcess | null = null;
let outputBuffer = "";
let httpTurns = 0;
const traces: Trace[] = [];
const diagnostics: Diagnostic[] = [];
const usage: Usage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const scenarios: ScenarioResult[] = [];

function parseServerLine(line: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return; }
  if (!isRecord(parsed)) return;
  if (parsed.event === "chatbot_intent_trace" && isRecord(parsed.modelProposal) && isRecord(parsed.finalProposal)
    && typeof parsed.correctionApplied === "boolean") {
    traces.push({ modelProposal: parsed.modelProposal, finalProposal: parsed.finalProposal, correctionApplied: parsed.correctionApplied });
  }
  if (parsed.event === "chatbot_query_diagnostic" && typeof parsed.intent === "string"
    && (typeof parsed.tool === "string" || parsed.tool === null)
    && typeof parsed.validation === "string" && typeof parsed.result === "string") {
    diagnostics.push({ intent: parsed.intent, tool: parsed.tool, validation: parsed.validation, result: parsed.result });
  }
  if (parsed.event === "chatbot_openai_usage") {
    for (const key of ["responseCalls", "inputTokens", "outputTokens", "totalTokens"] as const) {
      if (typeof parsed[key] === "number" && Number.isFinite(parsed[key])) usage[key] += parsed[key];
    }
  }
}

async function cleanTestRedis(): Promise<void> {
  for await (const keys of redis.scanIterator({ MATCH: `${redisPrefix}*`, COUNT: 100 })) {
    for (const key of keys) await redis.del(key);
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("El servidor de pruebas terminó antes de estar disponible");
    try { if ((await fetch(`${baseUrl}/`)).ok) return; } catch { /* continúa esperando */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor de pruebas no inició a tiempo");
}

async function chat(
  token: string,
  conversationId: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<TurnResult> {
  if (httpTurns >= MAX_HTTP_TURNS) throw new Error(`Se alcanzó el máximo de ${MAX_HTTP_TURNS} turnos HTTP`);
  const traceStart = traces.length;
  const diagnosticStart = diagnostics.length;
  httpTurns += 1;
  const response = await fetch(`${baseUrl}/api/chatbot/admin/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId, message, history }),
  });
  const payload: unknown = await response.json();
  if (response.status !== 200 || !isRecord(payload) || typeof payload.message !== "string") {
    throw new Error(`Respuesta HTTP inesperada en turno ${httpTurns}: ${response.status}`);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  if (usage.responseCalls > MAX_OPENAI_CALLS) throw new Error(`Se excedió el máximo de ${MAX_OPENAI_CALLS} llamadas a OpenAI`);
  return { message: payload.message, trace: traces[traceStart] ?? null, diagnostic: diagnostics[diagnosticStart] ?? null };
}

function evaluate(name: string, expected: readonly string[], turns: TurnResult[]): void {
  const combined = normalize(turns.map((turn) => turn.message).join("\n"));
  const missing = expected.filter((item) => !combined.includes(normalize(item)));
  scenarios.push({ name, expected, turns, passed: missing.length === 0, reason: missing.length === 0 ? null : `Falta evidencia: ${missing.join(", ")}` });
}

try {
  const [databaseRows] = await database.query<DatabaseRow[]>("SELECT DATABASE() databaseName");
  if (databaseRows[0]?.databaseName !== "preventive_bot_chatbot_test") throw new Error("MySQL no usa la base ficticia esperada");
  const [customers] = await database.query<FixtureCustomerRow[]>("SELECT CUIdCustomer, CUNIT FROM CUSTOMER WHERE CUName = 'Ana' ORDER BY CUIdCustomer DESC");
  if (customers.length !== 2 || customers[0]?.CUNIT !== customers[1]?.CUNIT || customers[1]?.CUIdCustomer !== 9001) {
    throw new Error("Los candidatos ficticios no permiten comprobar selección interna frente a NIT duplicado");
  }
  const [motorcycles] = await database.execute<FixtureMotorcycleRow[]>("SELECT CUIdCustomer, MOModel FROM MOTORCYCLES WHERE CUIdCustomer = ?", [9001]);
  if (motorcycles.length !== 1 || motorcycles[0]?.MOModel !== "Modelo Dos") throw new Error("La motocicleta ficticia del cliente seleccionado no coincide");

  await redis.connect();
  await cleanTestRedis();
  const sessionId = crypto.randomUUID();
  await redis.set(`${redisPrefix}session:${sessionId}`, JSON.stringify({ userId: 9001, email: "admin.chatbot@example.invalid" }), { EX: 1_800 });
  const token = jwt.sign({ sub: 9001, sid: sessionId }, requireVariable("JWT_SECRET"), { expiresIn: 1_800 });

  server = spawn(process.execPath, ["--import", "tsx", "src/app.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHATBOT_RAG_ENABLED: "false" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    outputBuffer += chunk.toString("utf8");
    const lines = outputBuffer.split("\n");
    outputBuffer = lines.pop() ?? "";
    for (const line of lines) parseServerLine(line);
  });
  await waitForServer();

  const direct = await chat(token, "focused_summary_01", "Dame un resumen de clientes");
  evaluate("Resumen directo de clientes", ["Total registrado: 3", "Activos: 2", "Inactivos: 1"], [direct]);

  const maintenanceQuestion = await chat(token, "focused_topic_0001", "Dame un resumen de los mantenimientos");
  const period = await chat(token, "focused_topic_0001", "Del 1 al 30 de septiembre de 2026", [
    { role: "user", content: "Dame un resumen de los mantenimientos" },
    { role: "assistant", content: maintenanceQuestion.message },
  ]);
  const topicChange = await chat(token, "focused_topic_0001", "¿y clientes?", [
    { role: "user", content: "Del 1 al 30 de septiembre de 2026" },
    { role: "assistant", content: period.message },
  ]);
  evaluate("Mantenimientos, período y cambio a clientes", ["fecha inicial y final", "Mantenimientos registrados: 1", "Total registrado: 3"], [maintenanceQuestion, period, topicChange]);

  const search = await chat(token, "focused_customer_1", "Busca clientes llamados Ana");
  const selection = await chat(token, "focused_customer_1", "2", [
    { role: "user", content: "Busca clientes llamados Ana" },
    { role: "assistant", content: search.message },
  ]);
  const associated = await chat(token, "focused_customer_1", "¿Qué motos tiene?", [
    { role: "assistant", content: selection.message },
  ]);
  evaluate("Nombre, candidatos, selección interna y motocicletas", ["Ana Primera", "Ana Segunda", "Responde con el número", "Ana Primera", "Modelo Dos"], [search, selection, associated]);

  const paraphrase = await chat(token, "focused_paraphrase", "Muéstrame un panorama de los clientes registrados");
  evaluate("Paráfrasis nueva de resumen", ["Total registrado: 3", "Activos: 2"], [paraphrase]);
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  if (outputBuffer.trim()) parseServerLine(outputBuffer.trim());
  if (redis.isOpen) await cleanTestRedis();
  if (redis.isOpen) await redis.quit();
  await database.end();
}

for (const scenario of scenarios) console.log(JSON.stringify(scenario));
console.log(JSON.stringify({
  scenarios: scenarios.length,
  passed: scenarios.filter((scenario) => scenario.passed).length,
  failed: scenarios.filter((scenario) => !scenario.passed).length,
  httpTurns,
  expectedOpenAICalls: EXPECTED_OPENAI_CALLS,
  maximumOpenAICalls: MAX_OPENAI_CALLS,
  actualOpenAICalls: usage.responseCalls,
  usage,
}));
if (scenarios.length !== 4 || scenarios.some((scenario) => !scenario.passed)
  || httpTurns !== MAX_HTTP_TURNS || usage.responseCalls > MAX_OPENAI_CALLS) process.exitCode = 1;
