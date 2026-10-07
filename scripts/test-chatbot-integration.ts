import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { createClient } from "redis";

const environmentFile = process.env.CHATBOT_TEST_ENV_FILE?.trim() || ".env.chatbot-test.local";
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: environmentFile, override: true, quiet: true });

interface ChatResponse { message: string }
interface ClientSessionResponse { accessToken: string; tokenType: "Client"; expiresIn: number }
interface DatabaseRow extends RowDataPacket { databaseName: string }
interface FixtureRow extends RowDataPacket { MOIdMoto: number }
interface AdminRow extends RowDataPacket { USId: number; ROIdRol: number | null }
interface UsageAggregate { responseCalls: number; inputTokens: number; outputTokens: number; totalTokens: number }

function requireVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}`);
  return value;
}

function requirePort(): number {
  const value = Number(requireVariable("PORT"));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("PORT de pruebas no es válido");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { throw new Error(`La API devolvió contenido no JSON con estado ${response.status}`); }
}

function assertChatResponse(value: unknown): ChatResponse {
  if (!isRecord(value) || typeof value.message !== "string" || !value.message.trim()) {
    throw new Error("La respuesta del chat no contiene un message válido");
  }
  return { message: value.message };
}

function assertClientSession(value: unknown): ClientSessionResponse {
  if (!isRecord(value) || typeof value.accessToken !== "string"
    || value.tokenType !== "Client" || typeof value.expiresIn !== "number") {
    throw new Error("La respuesta de sesión de cliente no tiene el formato esperado");
  }
  return { accessToken: value.accessToken, tokenType: value.tokenType, expiresIn: value.expiresIn };
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function requireAnswerEvidence(answer: ChatResponse, expected: readonly string[], scenario: string): void {
  const text = normalized(answer.message);
  if (!expected.every((item) => text.includes(normalized(item)))) {
    throw new Error(`La respuesta de ${scenario} no corresponde con los fixtures esperados`);
  }
}

function requireDeterministicMaintenance(answer: ChatResponse): void {
  requireAnswerEvidence(answer, [
    "Fecha del mantenimiento: 2026-03-01",
    "Lectura registrada: 1250",
    "Próxima lectura registrada: 2500",
    "Próxima fecha registrada: 2026-09-01",
    "Servicios realizados:",
    "Servicio ficticio",
  ], "mantenimientos del cliente");
  if (/\bkm\b|millas|lo que ocurra primero|cita confirmada/i.test(answer.message)) {
    throw new Error("La respuesta de mantenimientos agregó unidades o interpretaciones no registradas");
  }
}

function requirePlateWithoutInternalStateId(answer: ChatResponse, scenario: string): void {
  requireAnswerEvidence(answer, ["Solicitud primeras placas", "2026-01-12"], scenario);
  if (/\b(?:id|identificador)\s*(?:del\s+)?estado\b/i.test(answer.message)) {
    throw new Error(`La respuesta de ${scenario} expuso el identificador interno del estado`);
  }
}

function addUsageFromLine(line: string, aggregate: UsageAggregate): void {
  let parsed: unknown;
  try { parsed = JSON.parse(line) as unknown; } catch { return; }
  if (!isRecord(parsed) || parsed.event !== "chatbot_openai_usage") return;
  const fields = ["responseCalls", "inputTokens", "outputTokens", "totalTokens"] as const;
  if (!fields.every((field) => typeof parsed[field] === "number" && Number.isFinite(parsed[field]))) return;
  aggregate.responseCalls += Number(parsed.responseCalls);
  aggregate.inputTokens += Number(parsed.inputTokens);
  aggregate.outputTokens += Number(parsed.outputTokens);
  aggregate.totalTokens += Number(parsed.totalTokens);
}

async function requestJson(url: string, init: RequestInit, expectedStatus: number): Promise<unknown> {
  const response = await fetch(url, init);
  const data = await readJson(response);
  if (response.status !== expectedStatus) {
    const message = isRecord(data) && typeof data.message === "string" ? data.message : "respuesta inesperada";
    throw new Error(`Estado ${response.status} en lugar de ${expectedStatus}: ${message}`);
  }
  return data;
}

async function waitForServer(baseUrl: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error("El servidor de pruebas terminó antes de estar disponible");
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // El servidor aún está iniciando.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor de pruebas no estuvo disponible dentro del tiempo esperado");
}

if (requireVariable("CHATBOT_INTEGRATION_CONFIRM_FIXTURES") !== "true"
  || requireVariable("NODE_ENV") !== "test") {
  throw new Error("Prueba bloqueada: confirma fixtures y usa NODE_ENV=test");
}

const databaseName = requireVariable("DB_NAME");
if (!/test/i.test(databaseName)) throw new Error("Prueba bloqueada: DB_NAME debe identificar una base de pruebas");
const redisUrl = new URL(requireVariable("REDIS_URL"));
const redisKeyPrefix = requireVariable("REDIS_KEY_PREFIX");
if (redisKeyPrefix !== "preventive-bot:test:chatbot:"
  || requireVariable("CHATBOT_TEST_ALLOW_EXISTING_REDIS") !== "true") {
  throw new Error("Prueba bloqueada: falta el prefijo Redis exclusivo de integración");
}

const port = requirePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serieInvoice = requireVariable("CHATBOT_TEST_INVOICE_SERIES");
const numberInvoice = requireVariable("CHATBOT_TEST_INVOICE_NUMBER");
const startDate = requireVariable("CHATBOT_TEST_PERIOD_START");
const endDate = requireVariable("CHATBOT_TEST_PERIOD_END");
const jwtSecret = requireVariable("JWT_SECRET");

const database = await mysql.createConnection({
  host: requireVariable("DB_HOST"),
  port: Number(requireVariable("DB_PORT")),
  user: requireVariable("DB_USER"),
  password: requireVariable("DB_PASSWORD"),
  database: databaseName,
});
const redis = createClient({
  url: redisUrl.toString(),
  socket: { connectTimeout: 3_000, reconnectStrategy: false },
});
redis.on("error", () => undefined);
let server: ChildProcess | null = null;
let adminSessionId: string | null = null;
const usage: UsageAggregate = { responseCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
let serverOutput = "";

async function deleteIntegrationKeys(): Promise<number> {
  let deleted = 0;
  for await (const keys of redis.scanIterator({ MATCH: `${redisKeyPrefix}*`, COUNT: 100 })) {
    for (const key of keys) deleted += await redis.del(key);
  }
  return deleted;
}

try {
  const [databaseRows] = await database.query<DatabaseRow[]>("SELECT DATABASE() AS databaseName");
  if (databaseRows[0]?.databaseName !== databaseName) throw new Error("MySQL no está usando la base de pruebas esperada");
  const [fixtureRows] = await database.execute<FixtureRow[]>(
    "SELECT MOIdMoto FROM MOTORCYCLES WHERE MOSerieInvoice = ? AND MONumberInvoice = ?",
    [serieInvoice, numberInvoice],
  );
  if (fixtureRows.length !== 1) throw new Error("La factura ficticia debe identificar exactamente una motocicleta");
  const [adminRows] = await database.execute<AdminRow[]>(
    "SELECT USId, ROIdRol FROM USERS WHERE USId = ?",
    [9001],
  );
  if (adminRows.length !== 1 || adminRows[0]?.ROIdRol !== 1) throw new Error("Falta el administrador ficticio con rol 1");

  await redis.connect();
  await deleteIntegrationKeys();
  adminSessionId = crypto.randomUUID();
  await redis.set(`${redisKeyPrefix}session:${adminSessionId}`, JSON.stringify({
    userId: 9001,
    email: "admin.chatbot@example.invalid",
  }), { EX: 1_800 });
  const adminToken = jwt.sign({ sub: 9001, sid: adminSessionId }, jwtSecret, { expiresIn: 1_800 });

  server = spawn(process.execPath, ["--import", "tsx", "src/app.ts"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "ignore"],
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    serverOutput += chunk.toString("utf8");
    const lines = serverOutput.split("\n");
    serverOutput = lines.pop() ?? "";
    for (const line of lines) addUsageFromLine(line, usage);
  });
  await waitForServer(baseUrl, server);

  const jsonHeaders = { "Content-Type": "application/json" };
  const session = assertClientSession(await requestJson(`${baseUrl}/api/chatbot/client/session`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ serieInvoice, numberInvoice }),
  }, 201));
  const clientSessionKey = `${redisKeyPrefix}chatbot:client-session:${crypto.createHash("sha256").update(session.accessToken).digest("hex")}`;
  if (await redis.exists(clientSessionKey) !== 1) {
    throw new Error("El servidor no está utilizando el Redis aislado de la prueba");
  }
  const qualityOnly = process.env.CHATBOT_QUALITY_ONLY === "true";
  console.log(qualityOnly
    ? "Entorno focalizado: base, Redis y sesión de cliente verificados."
    : "1/6 Entorno, base, Redis y sesión de cliente verificados.");

  if (qualityOnly) {
    const maintenanceAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/client/chat`, {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Client ${session.accessToken}` },
      body: JSON.stringify({
        message: "Consulta el historial de mantenimientos registrado para mi motocicleta.",
        history: [],
      }),
    }, 200));
    requireDeterministicMaintenance(maintenanceAnswer);
    console.log("ESCENARIO 1 APROBADO: mantenimientos del cliente.");
    console.log(`Respuesta del escenario 1:\n${maintenanceAnswer.message}`);

    const combinedAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/admin/chat`, {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        message: "Consulta conjuntamente el último estado de placas y los mantenimientos registrados de esta motocicleta.",
        target: { type: "invoice", serieInvoice, numberInvoice },
        history: [],
      }),
    }, 200));
    requirePlateWithoutInternalStateId(combinedAnswer, "consulta combinada");
    requireDeterministicMaintenance(combinedAnswer);
    console.log("ESCENARIO 2 APROBADO: consulta combinada de placas y mantenimientos.");
    console.log(`Respuesta del escenario 2:\n${combinedAnswer.message}`);

    const closeResponse = await fetch(`${baseUrl}/api/chatbot/client/session`, {
      method: "DELETE", headers: { Authorization: `Client ${session.accessToken}` },
    });
    if (closeResponse.status !== 204 || (await closeResponse.text()) !== "") {
      throw new Error(`Cierre de sesión inesperado: ${closeResponse.status}`);
    }
  } else {

  const plateAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/client/chat`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Client ${session.accessToken}` },
    body: JSON.stringify({ message: "Consulta el último estado registrado de mi trámite de placas.", history: [] }),
  }, 200));
  requirePlateWithoutInternalStateId(plateAnswer, "placas del cliente");
  console.log("2/6 Consulta fundamentada de placas completada.");
  console.log(`Respuesta ficticia de placas: ${plateAnswer.message}`);

  const maintenanceAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/client/chat`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Client ${session.accessToken}` },
    body: JSON.stringify({
      message: "Consulta el historial de mantenimientos y menciona el servicio y la fecha del mantenimiento más reciente.",
      history: [
        { role: "user", content: "Consulta el último estado registrado de mi trámite de placas." },
        { role: "assistant", content: plateAnswer.message },
      ],
    }),
  }, 200));
  requireDeterministicMaintenance(maintenanceAnswer);
  console.log("3/6 Consulta fundamentada de mantenimientos completada.");
  console.log(`Respuesta ficticia de mantenimientos: ${maintenanceAnswer.message}`);

  const adminIndividualAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/admin/chat`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      message: "Consulta conjuntamente el último estado de placas y los mantenimientos registrados de esta motocicleta.",
      target: { type: "invoice", serieInvoice, numberInvoice },
      history: [],
    }),
  }, 200));
  requirePlateWithoutInternalStateId(adminIndividualAnswer, "consulta administrativa individual");
  requireDeterministicMaintenance(adminIndividualAnswer);
  console.log("4/6 Consulta administrativa individual completada.");
  console.log(`Respuesta ficticia administrativa individual: ${adminIndividualAnswer.message}`);

  const adminSummaryAnswer = assertChatResponse(await requestJson(`${baseUrl}/api/chatbot/admin/chat`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ message: `Resume los mantenimientos entre ${startDate} y ${endDate}.`, history: [] }),
  }, 200));
  const summaryText = normalized(adminSummaryAnswer.message);
  if (!summaryText.includes("mantenimiento") || (!summaryText.includes("1") && !summaryText.includes("un mantenimiento"))) {
    throw new Error("El resumen administrativo no corresponde con el único mantenimiento ficticio");
  }
  console.log("5/6 Resumen administrativo completado.");
  console.log(`Respuesta ficticia del resumen administrativo: ${adminSummaryAnswer.message}`);

  const closeResponse = await fetch(`${baseUrl}/api/chatbot/client/session`, {
    method: "DELETE", headers: { Authorization: `Client ${session.accessToken}` },
  });
  if (closeResponse.status !== 204 || (await closeResponse.text()) !== "") {
    throw new Error(`Cierre de sesión inesperado: ${closeResponse.status}`);
  }
  const rejectedResponse = await fetch(`${baseUrl}/api/chatbot/client/chat`, {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: `Client ${session.accessToken}` },
    body: JSON.stringify({ message: "Esta solicitud debe ser rechazada.", history: [] }),
  });
  const rejectedBody = await readJson(rejectedResponse);
  if (rejectedResponse.status !== 401 || !isRecord(rejectedBody)
    || rejectedBody.message !== "Sesión de consulta inválida o vencida") {
    throw new Error(`La credencial cerrada no fue rechazada: ${rejectedResponse.status}`);
  }
  console.log("6/6 Sesión cerrada y credencial rechazada correctamente.");
  }
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  if (serverOutput.trim()) addUsageFromLine(serverOutput.trim(), usage);
  if (redis.isOpen) await deleteIntegrationKeys();
  if (redis.isOpen) await redis.quit();
  await database.end();
  console.log(`Consumo OpenAI agregado: ${usage.responseCalls} llamadas, ${usage.inputTokens} tokens de entrada, ${usage.outputTokens} tokens de salida, ${usage.totalTokens} tokens totales.`);
}

console.log("Integración finalizada sin imprimir secretos ni credenciales.");
