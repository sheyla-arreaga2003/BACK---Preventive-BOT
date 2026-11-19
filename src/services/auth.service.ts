import crypto from "crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { redisClient, redisKey } from "../config/redis.js";
import { env } from "../config/env.js";
import { addUser, getUserByEmail, updateLastLoginDate, updateUserPasswordHash } from "./database.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import type { UserRow } from "../interfaces/database.interface.js";
import type * as IAuth from "../interfaces/auth.interface.js";

type LoginResult = IAuth.AuthFailure | IAuth.LoginSuccess;
export type TokenResult = IAuth.TokenFailure | IAuth.TokenSuccess;

interface RedisAuthClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number } | { KEEPTTL: true; XX: true }): Promise<unknown>;
  del(key: string): Promise<number>;
  sAdd?(key: string, member: string): Promise<number>;
  sRem?(key: string, member: string): Promise<number>;
  sMembers?(key: string): Promise<string[]>;
  expire?(key: string, seconds: number): Promise<number | boolean>;
}

interface AdminSessionRedis {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  sRem(key: string, member: string): Promise<number>;
  sMembers(key: string): Promise<string[]>;
}

interface LoginRedis {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  sAdd(key: string, member: string): Promise<number>;
  sRem(key: string, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
}

interface LoginDependencies {
  getUsersByEmail(email: string): Promise<UserRow[]>;
  updatePasswordHash(userId: number, passwordHash: string): Promise<void>;
  updateLastLogin(userId: number): Promise<void>;
  redis: LoginRedis;
  jwtSecret: string;
  randomUUID(): string;
  now(): Date;
}

interface TokenOperationDependencies {
  jwtSecret: string;
  redis: RedisAuthClient;
}

function normalizeUserId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function isValidSessionId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseSession(value: string): IAuth.SessionData | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const userId = normalizeUserId(record.userId);
    if (userId === null || typeof record.email !== "string" || record.email.trim().length === 0) return null;
    const session: IAuth.SessionData = {
      userId,
      email: record.email,
    };
    if (typeof record.publicId === "string") session.publicId = record.publicId;
    if (typeof record.createdAt === "string") session.createdAt = record.createdAt;
    if (typeof record.lastActivityAt === "string") session.lastActivityAt = record.lastActivityAt;
    if (typeof record.userAgent === "string") session.userAgent = record.userAgent;
    return session;
  } catch {
    return null;
  }
}

export function createTokenOperations(dependencies: TokenOperationDependencies) {
  async function validateToken(token: string): Promise<TokenResult> {
    let decoded: string | JwtPayload;
    try {
      decoded = jwt.verify(token, dependencies.jwtSecret);
    } catch {
      return { success: false, reason: "invalid_token" };
    }

    if (typeof decoded === "string") return { success: false, reason: "invalid_token" };
    const userId = normalizeUserId(decoded.sub);
    if (userId === null || !isValidSessionId(decoded.sid)) {
      return { success: false, reason: "invalid_token" };
    }

    let serializedSession: string | null;
    try {
      serializedSession = await dependencies.redis.get(redisKey(`session:${decoded.sid}`));
    } catch {
      return { success: false, reason: "session_store_unavailable" };
    }

    if (!serializedSession) return { success: false, reason: "invalid_session" };
    const session = parseSession(serializedSession);
    if (!session || session.userId !== userId) {
      return { success: false, reason: "invalid_session" };
    }

    return { success: true, userId, sessionid: decoded.sid, session };
  }

  async function logout(sessionid: string): Promise<{ success: boolean }> {
    if (!isValidSessionId(sessionid)) return { success: false };
    try {
      const sessionKey = redisKey(`session:${sessionid}`);
      const serialized = await dependencies.redis.get(sessionKey);
      const session = serialized ? parseSession(serialized) : null;
      await dependencies.redis.del(sessionKey);
      if (session && dependencies.redis.sRem) {
        await dependencies.redis.sRem(redisKey(`user-sessions:${session.userId}`), sessionid);
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  return { validateToken, logout };
}

const tokenOperations = createTokenOperations({ jwtSecret: env.JWT_SECRET, redis: redisClient });
export const validateToken = tokenOperations.validateToken;
export const logout = tokenOperations.logout;

export function createLoginValidator(dependencies: LoginDependencies) {
  return async (email: string, password: string, userAgent = ""): Promise<LoginResult> => {
    let users: UserRow[];
    try {
      users = await dependencies.getUsersByEmail(email);
    } catch {
      return { success: false, reason: "database_unavailable" };
    }

    const user = users[0];
    if (!user) return { success: false, reason: "invalid_credentials" };
    const passwordResult = await verifyPassword(user.USPassword, password);
    if (!passwordResult.valid) return { success: false, reason: "invalid_credentials" };

    if (passwordResult.needsUpgrade) {
      try {
        await dependencies.updatePasswordHash(user.USId, await hashPassword(password));
      } catch {
        return { success: false, reason: "database_unavailable" };
      }
    }

    const sessionid = dependencies.randomUUID();
    const expires = 60 * 60 * 4;
    const now = dependencies.now().toISOString();
    try {
      await dependencies.redis.set(
        redisKey(`session:${sessionid}`),
        JSON.stringify({
          userId: user.USId,
          email: user.USEmail,
          publicId: dependencies.randomUUID(),
          createdAt: now,
          lastActivityAt: now,
          userAgent: userAgent.slice(0, 500),
        }),
        { EX: expires },
      );
      const indexKey = redisKey(`user-sessions:${user.USId}`);
      await dependencies.redis.sAdd(indexKey, sessionid);
      await dependencies.redis.expire(indexKey, expires);
    } catch {
      try { await dependencies.redis.del(redisKey(`session:${sessionid}`)); } catch { /* best effort */ }
      return { success: false, reason: "session_store_unavailable" };
    }

    try {
      await dependencies.updateLastLogin(user.USId);
    } catch {
      try {
        await dependencies.redis.del(redisKey(`session:${sessionid}`));
        await dependencies.redis.sRem(redisKey(`user-sessions:${user.USId}`), sessionid);
      } catch { /* best effort */ }
      return { success: false, reason: "database_unavailable" };
    }

    const token = jwt.sign({ sub: user.USId, sid: sessionid }, dependencies.jwtSecret, { expiresIn: expires });
    return { success: true, sessionid, token, USName: user.USName };
  };
}

export const validateLogin = createLoginValidator({
  getUsersByEmail: getUserByEmail,
  updatePasswordHash: updateUserPasswordHash,
  updateLastLogin: updateLastLoginDate,
  redis: redisClient,
  jwtSecret: env.JWT_SECRET,
  randomUUID: crypto.randomUUID,
  now: () => new Date(),
});

const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export async function noteSessionActivity(sessionid: string, session: IAuth.SessionData): Promise<void> {
  const previous = session.lastActivityAt ? Date.parse(session.lastActivityAt) : Number.NaN;
  if (Number.isFinite(previous) && Date.now() - previous < ACTIVITY_WRITE_INTERVAL_MS) return;
  const value: IAuth.SessionData = { ...session, lastActivityAt: new Date().toISOString() };
  await redisClient.set(redisKey(`session:${sessionid}`), JSON.stringify(value), { KEEPTTL: true, XX: true });
}

function describeUserAgent(userAgent: string | undefined): { browser: string; operatingSystem: string; device: string } {
  const source = userAgent ?? "";
  const browser = /Edg\//.test(source) ? "Edge"
    : /Chrome\//.test(source) ? "Chrome"
      : /Firefox\//.test(source) ? "Firefox"
        : /Safari\//.test(source) ? "Safari" : "Desconocido";
  const operatingSystem = /Windows/.test(source) ? "Windows"
    : /Mac OS X|Macintosh/.test(source) ? "macOS"
      : /Android/.test(source) ? "Android"
        : /iPhone|iPad/.test(source) ? "iOS"
          : /Linux/.test(source) ? "Linux" : "Desconocido";
  const device = /Mobile|Android|iPhone/.test(source) ? "Móvil" : "Computadora";
  return { browser, operatingSystem, device };
}

export function createAdminSessionManager(redis: AdminSessionRedis, jwtSecret: string) {
  function publicReference(sessionid: string, session: IAuth.SessionData): string {
    return session.publicId ?? crypto.createHmac("sha256", jwtSecret).update(sessionid).digest("hex").slice(0, 32);
  }

  async function ownedSessions(userId: number, currentSessionId: string): Promise<Array<{ sid: string; data: IAuth.SessionData }>> {
    const indexKey = redisKey(`user-sessions:${userId}`);
    const indexed = await redis.sMembers(indexKey);
    const ids = [...new Set([...indexed, currentSessionId])];
    const sessions: Array<{ sid: string; data: IAuth.SessionData }> = [];
    for (const sid of ids) {
      const serialized = await redis.get(redisKey(`session:${sid}`));
      const data = serialized ? parseSession(serialized) : null;
      if (data?.userId === userId) sessions.push({ sid, data });
      else if (indexed.includes(sid)) await redis.sRem(indexKey, sid);
    }
    return sessions;
  }

  async function list(userId: number, currentSessionId: string) {
    const sessions = await ownedSessions(userId, currentSessionId);
    return sessions.map(({ sid, data }) => ({
      reference: publicReference(sid, data),
      current: sid === currentSessionId,
      createdAt: data.createdAt ?? null,
      lastActivityAt: data.lastActivityAt ?? null,
      ...describeUserAgent(data.userAgent),
    }));
  }

  async function revoke(userId: number, currentSessionId: string, reference: string): Promise<"deleted" | "current" | "not_found"> {
    const sessions = await ownedSessions(userId, currentSessionId);
    const target = sessions.find(({ sid, data }) => publicReference(sid, data) === reference);
    if (!target) return "not_found";
    if (target.sid === currentSessionId) return "current";
    await redis.del(redisKey(`session:${target.sid}`));
    await redis.sRem(redisKey(`user-sessions:${userId}`), target.sid);
    return "deleted";
  }

  async function revokeOthers(userId: number, currentSessionId: string): Promise<number> {
    const sessions = await ownedSessions(userId, currentSessionId);
    let deleted = 0;
    for (const target of sessions) {
      if (target.sid === currentSessionId) continue;
      deleted += await redis.del(redisKey(`session:${target.sid}`));
      await redis.sRem(redisKey(`user-sessions:${userId}`), target.sid);
    }
    return deleted;
  }

  return { list, revoke, revokeOthers };
}

const adminSessionManager = createAdminSessionManager(redisClient, env.JWT_SECRET);
export const listUserSessions = adminSessionManager.list;
export const revokeUserSession = adminSessionManager.revoke;
export const revokeOtherUserSessions = adminSessionManager.revokeOthers;

export const signup = async (name: string, roleId: number, lastname: string, email: string, phone: string, password: string): Promise<{ success: boolean }> => {
  try {
    const storedPasswordHash = await hashPassword(password);
    const created = await addUser(name, roleId, lastname, email, phone, storedPasswordHash);
    return { success: Boolean(created?.affectedRows) };
  } catch {
    return { success: false };
  }
};
