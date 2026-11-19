import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { env } from './env.js';

export const redisClient: RedisClientType = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    reconnectStrategy(retries) {
      if (retries >= 8) return false;
      return Math.min(250 * (2 ** Math.min(retries, 5)), 5_000);
    },
  },
});

let lastRedisErrorLogAt = 0;
redisClient.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLogAt >= 5_000) {
    lastRedisErrorLogAt = now;
    console.error('Redis Client Error:', err instanceof Error ? err.message : 'Unknown Redis error');
  }
});

export async function connectRedis(timeoutMs = env.REDIS_CONNECT_TIMEOUT_MS): Promise<void> {
  if (redisClient.isReady) return;
  const connection = redisClient.isOpen ? Promise.resolve() : redisClient.connect();
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      connection,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Redis connection timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function closeRedis(): Promise<void> {
  if (!redisClient.isOpen) return;
  if (redisClient.isReady) await redisClient.quit();
  else redisClient.destroy();
}

export function redisKey(key: string): string {
  return `${env.REDIS_KEY_PREFIX}${key}`;
}
