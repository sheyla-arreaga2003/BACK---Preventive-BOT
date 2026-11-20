import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import app from "./app.js";
import pool from "./config/database.js";
import { env } from "./config/env.js";
import { closeRedis, connectRedis } from "./config/redis.js";
import { startOptionalBackgroundWorkers, type WorkerController } from "./services/worker-runner.service.js";
import { gracefulShutdown } from "./services/lifecycle.service.js";
import { runStagingAdminInitializer, type InitializerPool } from "./services/staging-admin-initializer.service.js";

let worker: WorkerController | undefined;
let shuttingDown = false;

export async function shutdown(server: Server, signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Cierre controlado iniciado por ${signal}`);

  try {
    await gracefulShutdown({
      server,
      worker,
      closeMysql: () => pool.end(),
      closeRedis,
      timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      onTimeout: () => {
        console.error("El cierre controlado excedió el tiempo permitido");
        process.exitCode = 1;
      },
    });
    console.log("Cierre controlado completado");
  } catch (error: unknown) {
    console.error("El cierre controlado terminó con errores", error);
    process.exit(1);
  }
}

export async function startApplication(): Promise<Server> {
  const adminInitialization = await runStagingAdminInitializer(pool as unknown as InitializerPool, {
    enabled: env.STAGING_ADMIN_INIT_ENABLED,
    nodeEnvironment: env.NODE_ENV,
    railwayProjectId: env.RAILWAY_PROJECT_ID,
    railwayEnvironmentId: env.RAILWAY_ENVIRONMENT_ID,
    railwayServiceId: env.RAILWAY_SERVICE_ID,
    passwordHash: env.STAGING_ADMIN_PASSWORD_HASH,
  });
  if (adminInitialization.status === "preflight_failed"
    || adminInitialization.status === "insert_failed"
    || adminInitialization.status === "verification_failed") {
    throw new Error(`La inicialización temporal del administrador no pudo completarse: ${adminInitialization.status}`);
  }

  try {
    await connectRedis();
  } catch {
    console.error("No fue posible conectar con Redis; /health/ready permanecerá no disponible.");
  }

  worker = startOptionalBackgroundWorkers(env.REMINDER_WORKER_ENABLED, env.WORKER_INTERVAL_MS);
  if (worker) {
    console.log("Workers periódicos habilitados");
  } else {
    console.log("Workers periódicos deshabilitados");
  }

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`Servidor ejecutándose en ${env.HOST}:${env.PORT}`);
  });
  server.on("error", (error) => console.error("Error del servidor HTTP", error));

  process.once("SIGTERM", () => void shutdown(server, "SIGTERM"));
  process.once("SIGINT", () => void shutdown(server, "SIGINT"));
  return server;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void startApplication().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error(`No fue posible iniciar el backend: ${message}`);
    process.exitCode = 1;
  });
}
