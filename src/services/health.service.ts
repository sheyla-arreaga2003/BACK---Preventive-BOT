import pool from "../config/database.js";
import { redisClient } from "../config/redis.js";

export interface HealthDependencies {
  mysql: { query(sql: string): Promise<unknown> };
  redis: { isOpen: boolean; ping(): Promise<string> };
}

export interface ReadinessResult {
  ready: boolean;
  status: "ready" | "not_ready";
  checks: { mysql: "up" | "down"; redis: "up" | "down" };
}

export async function checkReadiness(dependencies: HealthDependencies): Promise<ReadinessResult> {
  const [mysqlResult, redisResult] = await Promise.allSettled([
    dependencies.mysql.query("SELECT 1"),
    dependencies.redis.isOpen
      ? dependencies.redis.ping()
      : Promise.reject(new Error("Redis is not connected")),
  ]);
  const checks = {
    mysql: mysqlResult.status === "fulfilled" ? "up" as const : "down" as const,
    redis: redisResult.status === "fulfilled" ? "up" as const : "down" as const,
  };
  const ready = checks.mysql === "up" && checks.redis === "up";
  return { ready, status: ready ? "ready" : "not_ready", checks };
}

export function readiness(): Promise<ReadinessResult> {
  return checkReadiness({ mysql: pool, redis: redisClient });
}
