import { randomUUID } from "node:crypto";
import { redisClient, redisKey } from "../config/redis.js";

const RENEW_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

export class DistributedLockLostError extends Error {
  constructor(lockName: string) {
    super(`Se perdió la propiedad del bloqueo distribuido ${lockName}`);
    this.name = "DistributedLockLostError";
  }
}

export interface DistributedLockContext {
  readonly name: string;
  readonly ownerId: string;
  assertOwnership(): Promise<void>;
}

export type DistributedLockResult = "executed" | "skipped";

export interface DistributedLockRunner {
  run(
    name: string,
    task: (context: DistributedLockContext) => Promise<void>,
  ): Promise<DistributedLockResult>;
}

export function createRedisDistributedLockRunner(options: {
  ttlMs: number;
  renewalMs: number;
}): DistributedLockRunner {
  const ttlMs = Math.max(1_000, options.ttlMs);
  const renewalMs = Math.max(250, Math.min(options.renewalMs, Math.floor(ttlMs / 2)));

  return {
    async run(name, task) {
      if (!redisClient.isReady) throw new Error("Redis no está disponible para adquirir el bloqueo");
      const key = redisKey(`worker-lock:${name}`);
      const ownerId = randomUUID();
      const acquired = await redisClient.set(key, ownerId, { NX: true, PX: ttlMs });
      if (acquired !== "OK") return "skipped";

      let lost = false;
      let renewing: Promise<void> = Promise.resolve();
      const renew = async () => {
        if (lost || !redisClient.isReady) {
          lost = true;
          return;
        }
        try {
          const renewed = await redisClient.eval(RENEW_SCRIPT, {
            keys: [key],
            arguments: [ownerId, String(ttlMs)],
          });
          if (Number(renewed) !== 1) lost = true;
        } catch {
          lost = true;
        }
      };
      const timer = setInterval(() => {
        renewing = renewing.then(renew, () => renew());
      }, renewalMs);
      timer.unref();

      const context: DistributedLockContext = {
        name,
        ownerId,
        async assertOwnership() {
          if (lost || !redisClient.isReady) throw new DistributedLockLostError(name);
          const currentOwner = await redisClient.get(key).catch(() => null);
          if (currentOwner !== ownerId) {
            lost = true;
            throw new DistributedLockLostError(name);
          }
        },
      };

      try {
        await context.assertOwnership();
        await task(context);
        await context.assertOwnership();
        return "executed";
      } finally {
        clearInterval(timer);
        await renewing.catch(() => undefined);
        if (redisClient.isReady) {
          await redisClient.eval(RELEASE_SCRIPT, {
            keys: [key],
            arguments: [ownerId],
          }).catch(() => undefined);
        }
      }
    },
  };
}
