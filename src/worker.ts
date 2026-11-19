import pool from "./config/database.js";
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { closeRedis, connectRedis } from "./config/redis.js";
import { startBackgroundWorkers } from "./services/worker-runner.service.js";

let shuttingDown = false;

async function run(): Promise<void> {
  if (!env.REMINDER_WORKER_ENABLED) {
    console.log("Worker deshabilitado mediante REMINDER_WORKER_ENABLED=false");
    await pool.end();
    return;
  }
  await connectRedis();
  const controller = startBackgroundWorkers(env.WORKER_INTERVAL_MS);
  console.log("Worker independiente iniciado");

  const stop = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Cierre del worker iniciado por ${signal}`);
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          await controller.stop();
          await pool.end();
          await closeRedis();
        })(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Worker shutdown timed out")),
            env.SHUTDOWN_TIMEOUT_MS,
          );
        }),
      ]);
      console.log("Worker detenido");
    } catch (error: unknown) {
      console.error("El worker no pudo cerrarse correctamente", error);
      process.exit(1);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run().catch((error: unknown) => {
    console.error("No fue posible iniciar el worker", error);
    process.exitCode = 1;
  });
}
