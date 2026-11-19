import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const baseEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  JWT_SECRET: "chatbot-disabled-test-secret-with-more-than-32-characters",
  DB_HOST: "127.0.0.1",
  DB_USER: "isolated-test-user",
  DB_PASSWORD: "isolated-test-password",
  DB_NAME: "isolated-test-database",
  REDIS_URL: "redis://127.0.0.1:6379",
  REMINDER_WORKER_ENABLED: "false",
  MAIL_DELIVERY_ENABLED: "false",
  GOVERNMENT_AUTOMATIONS_ENABLED: "false",
};

function runModule(code: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
}

test("CHATBOT_ENABLED=false inicia sin credenciales OpenAI y devuelve 503", () => {
  const result = runModule(`
    import request from "supertest";
    const [{ default: app }, { env }, { openAIClientInitialized }] = await Promise.all([
      import("./src/app.ts"),
      import("./src/config/env.ts"),
      import("./src/services/chatbot-model.service.ts"),
    ]);
    const responses = await Promise.all([
      request(app).post("/api/chatbot/client/chat").send({ message: "hola" }),
      request(app).post("/api/chatbot/admin/chat").send({ message: "hola" }),
      request(app).delete("/api/chatbot/admin/conversation/conversation_1234"),
    ]);
    const [clientPortal, health] = await Promise.all([
      request(app).get("/api/chatbot/client/overview"),
      request(app).get("/health/live"),
    ]);
    console.log(JSON.stringify({
      enabled: env.CHATBOT_ENABLED,
      ragEnabled: env.CHATBOT_RAG_ENABLED,
      openAIClientInitialized,
      statuses: responses.map((response) => response.status),
      messages: responses.map((response) => response.body.message),
      clientPortalStatus: clientPortal.status,
      healthStatus: health.status,
    }));
  `, {
    ...baseEnvironment,
    CHATBOT_ENABLED: "false",
    CHATBOT_RAG_ENABLED: "true",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim()) as {
    enabled: boolean;
    ragEnabled: boolean;
    openAIClientInitialized: boolean;
    statuses: number[];
    messages: string[];
    clientPortalStatus: number;
    healthStatus: number;
  };
  assert.equal(output.enabled, false);
  assert.equal(output.ragEnabled, false);
  assert.equal(output.openAIClientInitialized, false);
  assert.deepEqual(output.statuses, [503, 503, 503]);
  assert.deepEqual(output.messages, [
    "El chatbot no está disponible en este entorno",
    "El chatbot no está disponible en este entorno",
    "El chatbot no está disponible en este entorno",
  ]);
  assert.equal(output.clientPortalStatus, 401);
  assert.equal(output.healthStatus, 200);
});

test("CHATBOT_ENABLED=true conserva la validación y crea el cliente sin enviar solicitudes", () => {
  const missingCredentials = runModule('await import("./src/config/env.ts");', {
    ...baseEnvironment,
    CHATBOT_ENABLED: "true",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
  });
  assert.notEqual(missingCredentials.status, 0);
  assert.match(missingCredentials.stderr, /Missing required environment variable: OPENAI_API_KEY/);

  const missingModel = runModule('await import("./src/config/env.ts");', {
    ...baseEnvironment,
    CHATBOT_ENABLED: "true",
    OPENAI_API_KEY: "test-key-that-is-never-used",
    OPENAI_MODEL: "",
  });
  assert.notEqual(missingModel.status, 0);
  assert.match(missingModel.stderr, /Missing required environment variable: OPENAI_MODEL/);

  const configured = runModule(`
    const [{ env }, { openAIClientInitialized }] = await Promise.all([
      import("./src/config/env.ts"),
      import("./src/services/chatbot-model.service.ts"),
    ]);
    console.log(JSON.stringify({ enabled: env.CHATBOT_ENABLED, openAIClientInitialized }));
  `, {
    ...baseEnvironment,
    CHATBOT_ENABLED: "true",
    OPENAI_API_KEY: "test-key-that-is-never-used",
    OPENAI_MODEL: "test-model-that-is-never-used",
  });
  assert.equal(configured.status, 0, configured.stderr);
  assert.deepEqual(JSON.parse(configured.stdout.trim()), {
    enabled: true,
    openAIClientInitialized: true,
  });
});

test("CHATBOT_ENABLED conserva true como valor predeterminado", () => {
  const environment = {
    ...baseEnvironment,
    OPENAI_API_KEY: "test-key-that-is-never-used",
    OPENAI_MODEL: "test-model-that-is-never-used",
  };
  delete environment.CHATBOT_ENABLED;
  const result = runModule(`
    const { env } = await import("./src/config/env.ts");
    console.log(JSON.stringify({ enabled: env.CHATBOT_ENABLED }));
  `, environment);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { enabled: true });
});

test("CHATBOT_ENABLED rechaza valores ambiguos", () => {
  const result = runModule('await import("./src/config/env.ts");', {
    ...baseEnvironment,
    CHATBOT_ENABLED: "enabled",
    OPENAI_API_KEY: "test-key-that-is-never-used",
    OPENAI_MODEL: "test-model-that-is-never-used",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHATBOT_ENABLED must be true or false/);
});
