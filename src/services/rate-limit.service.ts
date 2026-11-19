import { redisClient } from "../config/redis.js";

interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

export interface RateLimitStore {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export interface RateLimitRedis {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export function createRateLimitStore(redis: RateLimitRedis): RateLimitStore {
  return {
    async consume(key, limit, windowSeconds) {
      const result = await redis.eval(RATE_LIMIT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      });
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error("Invalid rate limit response");
      }
      const count = Number(result[0]);
      const ttl = Number(result[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw new Error("Invalid rate limit response");
      }
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    },
  };
}

export const rateLimitStore = createRateLimitStore(redisClient);
