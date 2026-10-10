import crypto from "crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { redisClient, redisKey } from "../config/redis.js";
import { env } from "../config/env.js";
import { addUser, getUserByEmail } from "./database.service.js";
import type { UserRow } from "../interfaces/database.interface.js";
import type * as IAuth from "../interfaces/auth.interface.js";

type LoginResult = IAuth.AuthFailure | IAuth.LoginSuccess;
export type TokenResult = IAuth.TokenFailure | IAuth.TokenSuccess;

interface RedisAuthClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
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

function parseSession(value: string): IAuth.SessionData | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const userId = normalizeUserId(record.userId);
    if (userId === null || typeof record.email !== "string" || record.email.trim().length === 0) return null;
    return { userId, email: record.email };
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
      await dependencies.redis.del(redisKey(`session:${sessionid}`));
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

export const validateLogin = async (email: string, password: string): Promise<LoginResult> => {
  let users: UserRow[];
  try {
    users = await getUserByEmail(email);
  } catch {
    return { success: false, reason: "database_unavailable" };
  }

  const user = users[0];
  if (!user) return { success: false, reason: "invalid_credentials" };

  try {
    const inputPasswordHash = crypto.createHash("sha256").update(password).digest("hex");
    if (user.USPassword !== inputPasswordHash) return { success: false, reason: "invalid_credentials" };
  } catch {
    return { success: false, reason: "invalid_credentials" };
  }

  const sessionid = crypto.randomUUID();
  const expires = 60 * 60 * 4;
  try {
    await redisClient.set(
      redisKey(`session:${sessionid}`),
      JSON.stringify({ userId: user.USId, email: user.USEmail }),
      { EX: expires },
    );
  } catch {
    return { success: false, reason: "session_store_unavailable" };
  }

  const token = jwt.sign({ sub: user.USId, sid: sessionid }, env.JWT_SECRET, { expiresIn: expires });
  return { success: true, sessionid, token, USName: user.USName };
};

export const signup = async (name: string, roleId: number, lastname: string, email: string, phone: string, password: string): Promise<{ success: boolean }> => {
  try {
    const storedPasswordHash = crypto.createHash("sha256").update(password).digest("hex");
    const created = await addUser(name, roleId, lastname, email, phone, storedPasswordHash);
    return { success: Boolean(created?.affectedRows) };
  } catch {
    return { success: false };
  }
};
