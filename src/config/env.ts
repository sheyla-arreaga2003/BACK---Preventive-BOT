import dotenv from "dotenv";

dotenv.config({ quiet: true });

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = Object.freeze({
  JWT_SECRET: requireEnvironmentVariable("JWT_SECRET"),
  OPENAI_API_KEY: requireEnvironmentVariable("OPENAI_API_KEY"),
  OPENAI_MODEL: requireEnvironmentVariable("OPENAI_MODEL"),
  REDIS_URL: process.env.REDIS_URL?.trim() || "redis://localhost:6379",
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX?.trim() || "",
  PORT: Number(process.env.PORT) || 3000,
  CHATBOT_RAG_ENABLED: process.env.CHATBOT_RAG_ENABLED?.trim().toLowerCase() === "true",
  CHATBOT_DOCUMENT_INDEX_PATH: process.env.CHATBOT_DOCUMENT_INDEX_PATH?.trim() || "var/chatbot-documents/index.json",
});
