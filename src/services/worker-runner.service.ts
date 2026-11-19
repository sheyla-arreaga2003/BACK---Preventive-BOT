import { closeExpiredMaintenanceAppointments } from "./maintenance-appointment.service.js";
import { generateScheduledNotifications } from "./notification.service.js";
import { processPendingReminders } from "./reminder.service.js";
import { env } from "../config/env.js";
import {
  createRedisDistributedLockRunner,
  type DistributedLockContext,
  type DistributedLockRunner,
} from "./distributed-lock.service.js";

export interface WorkerDependencies {
  processReminders(assertOwnership?: () => Promise<void>): Promise<void>;
  closeExpiredAppointments(assertOwnership?: () => Promise<void>): Promise<number>;
  generateNotifications(assertOwnership?: () => Promise<void>): Promise<void>;
}

export interface WorkerController {
  stop(): Promise<void>;
}

const productionDependencies: WorkerDependencies = {
  processReminders: processPendingReminders,
  closeExpiredAppointments: closeExpiredMaintenanceAppointments,
  generateNotifications: generateScheduledNotifications,
};

const productionLockRunner = createRedisDistributedLockRunner({
  ttlMs: env.WORKER_LOCK_TTL_MS,
  renewalMs: env.WORKER_LOCK_RENEWAL_MS,
});

function periodicTask(
  name: string,
  intervalMs: number,
  task: (context: DistributedLockContext) => Promise<void>,
  lockRunner: DistributedLockRunner,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      active = lockRunner.run(name, task)
        .then((result) => {
          if (result === "skipped") console.log(`Ciclo ${name} omitido: bloqueo ocupado`);
        })
        .catch((error: unknown) => console.error(`Error en worker ${name}`, error))
        .finally(schedule);
    }, intervalMs);
    timer.unref();
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}

export function startBackgroundWorkers(
  intervalMs: number,
  dependencies: WorkerDependencies = productionDependencies,
  lockRunner: DistributedLockRunner = productionLockRunner,
): WorkerController {
  const reminders = periodicTask("recordatorios", intervalMs, async (context) => {
    await dependencies.processReminders(context.assertOwnership);
  }, lockRunner);
  const appointments = periodicTask("citas-notificaciones", intervalMs, async (context) => {
    await dependencies.closeExpiredAppointments(context.assertOwnership);
    await context.assertOwnership();
    await dependencies.generateNotifications(context.assertOwnership);
  }, lockRunner);
  return {
    async stop() {
      await Promise.all([reminders.stop(), appointments.stop()]);
    },
  };
}

export function startOptionalBackgroundWorkers(
  enabled: boolean,
  intervalMs: number,
  dependencies: WorkerDependencies = productionDependencies,
): WorkerController | undefined {
  return enabled ? startBackgroundWorkers(intervalMs, dependencies) : undefined;
}
