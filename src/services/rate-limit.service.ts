import { redisClient } from "../config/redis.js";

interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

export interface RateLimitStore {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export function createRateLimitStore(redis: RateLimitRedis): RateLimitStore {
  return {
    async consume(key, limit, windowSeconds) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      const ttl = await redis.ttl(key);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    },
  };
}

export const rateLimitStore = createRateLimitStore(redisClient);
