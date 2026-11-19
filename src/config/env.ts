import dotenv from "dotenv";
import { parseCorsOrigins } from "./cors.js";

dotenv.config({ quiet: true });

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnvironment = process.env.NODE_ENV?.trim() || "development";
const chatbotSetting = process.env.CHATBOT_ENABLED?.trim().toLowerCase();
const workerSetting = process.env.REMINDER_WORKER_ENABLED?.trim().toLowerCase();
const mailDeliverySetting = process.env.MAIL_DELIVERY_ENABLED?.trim().toLowerCase();
const governmentAutomationsSetting = process.env.GOVERNMENT_AUTOMATIONS_ENABLED?.trim().toLowerCase();
if (chatbotSetting !== undefined && chatbotSetting !== "" && !["true", "false"].includes(chatbotSetting)) {
  throw new Error("CHATBOT_ENABLED must be true or false");
}
const chatbotEnabled = chatbotSetting === undefined || chatbotSetting === ""
  ? true
  : chatbotSetting === "true";

export const env = Object.freeze({
  NODE_ENV: nodeEnvironment,
  JWT_SECRET: requireEnvironmentVariable("JWT_SECRET"),
  CHATBOT_ENABLED: chatbotEnabled,
  OPENAI_API_KEY: chatbotEnabled
    ? requireEnvironmentVariable("OPENAI_API_KEY")
    : process.env.OPENAI_API_KEY?.trim() || "",
  OPENAI_MODEL: chatbotEnabled
    ? requireEnvironmentVariable("OPENAI_MODEL")
    : process.env.OPENAI_MODEL?.trim() || "",
  REDIS_URL: process.env.REDIS_URL?.trim() || "redis://localhost:6379",
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX?.trim() || "",
  REDIS_CONNECT_TIMEOUT_MS: Math.max(500, Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 5_000),
  HOST: process.env.HOST?.trim() || "0.0.0.0",
  PORT: Number(process.env.PORT) || 3000,
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS ?? ""),
  ALLOW_PRIVATE_NETWORK_ORIGINS: process.env.ALLOW_PRIVATE_NETWORK_ORIGINS?.trim().toLowerCase()
    === "true" || (nodeEnvironment !== "production" && process.env.ALLOW_PRIVATE_NETWORK_ORIGINS === undefined),
  CHATBOT_RAG_ENABLED: chatbotEnabled
    && process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true",
  CHATBOT_DOCUMENT_INDEX_PATH: process.env.CHATBOT_DOCUMENT_INDEX_PATH?.trim() || "var/chatbot-documents/index.json",
  REMINDER_WORKER_ENABLED: workerSetting === "true" || (nodeEnvironment !== "production" && workerSetting === undefined),
  MAIL_DELIVERY_ENABLED: mailDeliverySetting === "true"
    || (nodeEnvironment !== "production" && mailDeliverySetting === undefined),
  GOVERNMENT_AUTOMATIONS_ENABLED: governmentAutomationsSetting === "true"
    || (nodeEnvironment !== "production" && governmentAutomationsSetting === undefined),
  CAPSOLVER_API_KEY: process.env.CAPSOLVER_API_KEY?.trim() || "",
  DB_HOST: requireEnvironmentVariable("DB_HOST"),
  DB_PORT: Number(process.env.DB_PORT) || 3306,
  DB_USER: requireEnvironmentVariable("DB_USER"),
  DB_PASSWORD: requireEnvironmentVariable("DB_PASSWORD"),
  DB_NAME: requireEnvironmentVariable("DB_NAME"),
  DB_CONNECTION_LIMIT: Math.max(1, Number(process.env.DB_CONNECTION_LIMIT) || 10),
  DB_CONNECT_TIMEOUT_MS: Math.max(1_000, Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000),
  DB_SSL_MODE: process.env.DB_SSL_MODE?.trim().toLowerCase() || "disabled",
  DB_TIMEZONE: process.env.DB_TIMEZONE?.trim() || "-06:00",
  SHUTDOWN_TIMEOUT_MS: Math.max(1_000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000),
  WORKER_INTERVAL_MS: Math.max(10_000, Number(process.env.WORKER_INTERVAL_MS) || 60_000),
  WORKER_LOCK_TTL_MS: Math.max(5_000, Number(process.env.WORKER_LOCK_TTL_MS) || 120_000),
  WORKER_LOCK_RENEWAL_MS: Math.max(1_000, Number(process.env.WORKER_LOCK_RENEWAL_MS) || 30_000),
  REMINDER_RETRY_DELAY_SECONDS: Math.max(10, Number(process.env.REMINDER_RETRY_DELAY_SECONDS) || 60),
});
