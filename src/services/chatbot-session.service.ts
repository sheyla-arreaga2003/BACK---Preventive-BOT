import crypto from "node:crypto";
import { redisClient, redisKey } from "../config/redis.js";
import type { ClientChatSession } from "../interfaces/chatbot.interface.js";

export const CLIENT_SESSION_TTL_SECONDS = 30 * 60;

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sessionKey(credential: string): string {
  return redisKey(`chatbot:client-session:${digest(credential)}`);
}

function parseSession(value: string): ClientChatSession | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!Number.isSafeInteger(record.motorcycleId) || Number(record.motorcycleId) < 1) return null;
    if (typeof record.createdAt !== "string" || !record.createdAt) return null;
    return { motorcycleId: Number(record.motorcycleId), createdAt: record.createdAt };
  } catch {
    return null;
  }
}

export interface ClientSessionStore {
  create(motorcycleId: number): Promise<{ credential: string; expiresIn: number }>;
  read(credential: string): Promise<ClientChatSession | null>;
  close(credential: string): Promise<boolean>;
}

export interface ClientSessionRedis {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export function createClientSessionStore(redis: ClientSessionRedis): ClientSessionStore {
  return {
    async create(motorcycleId) {
      const credential = crypto.randomBytes(32).toString("base64url");
      const session: ClientChatSession = { motorcycleId, createdAt: new Date().toISOString() };
      await redis.set(sessionKey(credential), JSON.stringify(session), { EX: CLIENT_SESSION_TTL_SECONDS });
      return { credential, expiresIn: CLIENT_SESSION_TTL_SECONDS };
    },
    async read(credential) {
      if (!credential) return null;
      const value = await redis.get(sessionKey(credential));
      return value ? parseSession(value) : null;
    },
    async close(credential) {
      if (!credential) return false;
      return (await redis.del(sessionKey(credential))) > 0;
    },
  };
}

export const clientSessionStore = createClientSessionStore(redisClient);

export function hashRateLimitSubject(value: string): string {
  return digest(value);
}
