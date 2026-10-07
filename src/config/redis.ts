import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { env } from './env.js';

export const redisClient: RedisClientType = createClient({
  url: env.REDIS_URL,
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

export async function connectRedis(): Promise<void> {
  if (!redisClient.isOpen) await redisClient.connect();
}

export function redisKey(key: string): string {
  return `${env.REDIS_KEY_PREFIX}${key}`;
}
