import type { Server } from "node:http";
import type { WorkerController } from "./worker-runner.service.js";

export interface ShutdownDependencies {
  server: Server;
  worker?: WorkerController | undefined;
  closeMysql(): Promise<void>;
  closeRedis(): Promise<void>;
  timeoutMs: number;
  onTimeout?(): void;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function gracefulShutdown(dependencies: ShutdownDependencies): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const cleanup = async () => {
    await closeHttpServer(dependencies.server);
    await dependencies.worker?.stop();
    await dependencies.closeMysql();
    await dependencies.closeRedis();
  };

  try {
    await Promise.race([
      cleanup(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          dependencies.server.closeAllConnections();
          dependencies.onTimeout?.();
          reject(new Error("Graceful shutdown timed out"));
        }, dependencies.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
