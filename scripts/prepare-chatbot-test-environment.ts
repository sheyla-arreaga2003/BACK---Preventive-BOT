import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { createClient } from "redis";

const environmentFile = process.env.CHATBOT_TEST_ENV_FILE?.trim() || ".env.chatbot-test.local";
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: environmentFile, override: true, quiet: true });

function requireVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}`);
  return value;
}

if (requireVariable("NODE_ENV") !== "test"
  || requireVariable("CHATBOT_INTEGRATION_CONFIRM_FIXTURES") !== "true") {
  throw new Error("Preparación bloqueada: se requiere NODE_ENV=test y confirmación de fixtures");
}

const databaseName = requireVariable("DB_NAME");
if (databaseName !== "preventive_bot_chatbot_test") {
  throw new Error("Preparación bloqueada: el nombre de la base de prueba no coincide exactamente");
}
const redisUrl = new URL(requireVariable("REDIS_URL"));
const redisKeyPrefix = requireVariable("REDIS_KEY_PREFIX");
if (redisKeyPrefix !== "preventive-bot:test:chatbot:"
  || requireVariable("CHATBOT_TEST_ALLOW_EXISTING_REDIS") !== "true") {
  throw new Error("Preparación bloqueada: falta el prefijo Redis exclusivo de integración");
}

const connectionOptions = {
  host: requireVariable("DB_HOST"),
  port: Number(requireVariable("DB_PORT")),
  user: requireVariable("DB_USER"),
  password: requireVariable("DB_PASSWORD"),
};
const administration = await mysql.createConnection(connectionOptions);
const redis = createClient({
  url: redisUrl.toString(),
  socket: { connectTimeout: 3_000, reconnectStrategy: false },
});
redis.on("error", () => undefined);
let administrationOpen = true;

async function deleteIntegrationKeys(): Promise<number> {
  let deleted = 0;
  for await (const keys of redis.scanIterator({ MATCH: `${redisKeyPrefix}*`, COUNT: 100 })) {
    for (const key of keys) deleted += await redis.del(key);
  }
  return deleted;
}

try {
  await administration.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  await administration.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await administration.end();
  administrationOpen = false;

  const fixtures = await readFile(new URL("../test/fixtures/chatbot-test.sql", import.meta.url), "utf8");
  const fixtureConnection = await mysql.createConnection({
    ...connectionOptions,
    database: databaseName,
    multipleStatements: true,
  });
  try { await fixtureConnection.query(fixtures); } finally { await fixtureConnection.end(); }
  console.log("Base MySQL de prueba preparada con fixtures ficticios.");

  try {
    await redis.connect();
  } catch {
    throw new Error("El servicio Redis configurado no está disponible");
  }
  await deleteIntegrationKeys();
  console.log("Prefijo Redis exclusivo preparado para la integración.");
} finally {
  if (administrationOpen) await administration.end().catch(() => undefined);
  if (redis.isOpen) await redis.quit();
}
