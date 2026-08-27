import { getUserByEmail, addUser } from './database.service.js';
import crypto from 'crypto';
import jwt, { type JwtPayload } from "jsonwebtoken";
import { redisClient } from '../config/redis.js';

interface AuthFailure {
  success: false;
}

interface LoginSuccess {
  success: true;
  sessionid: string;
  token: string;
}

interface TokenSuccess {
  success: true;
  userId: string | number;
  sessionid: string;
}

type LoginResult = AuthFailure | LoginSuccess;
type TokenResult = AuthFailure | TokenSuccess;

export const validateLogin = async (email: string, password: string): Promise<LoginResult> => {
  try {
    const users = await getUserByEmail(email);
    const user = users[0];
    
    if (!user) {
      return { success: false };
    }

    const storedPasswordHash = user.USPassword;
    const inputPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (storedPasswordHash !== inputPasswordHash) {
      return { success: false };
    }

    const sessionid = crypto.randomUUID();

    const expires = 60 * 60 * 4;

    await redisClient.set(
      `session:${sessionid}`,
      JSON.stringify({ userId: user.USId, email: user.USEmail }),
      { EX: expires },
    );

    const token = jwt.sign(
      { sub: user.USId, sid: sessionid },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: expires },
    );

    return { success: true, sessionid, token };
  } catch {
    return { success: false };
  }
};

export const validateToken = async (token: string): Promise<TokenResult> => {
  try {
    const decoded: string | JwtPayload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'default_secret',
    );

    if (
      typeof decoded === "string" ||
      !decoded.sub ||
      typeof decoded.sid !== "string"
    ) {
      return { success: false };
    }
    
    return { success: true, userId: decoded.sub, sessionid: decoded.sid };
  } catch {
    return { success: false };
  }
};

export const logout = async (sessionid: string): Promise<{ success: boolean }> => {
  try {
    await redisClient.del(`session:${sessionid}`);

    return { success: true };
  } catch {
    return { success: false };
  }
};

export const signup = async (name: string, roleId: number, lastname: string, email: string, phone: string, password: string): Promise<{ success: boolean }> => {
  try {
    const storedPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
    const created = await addUser(name, roleId, lastname, email, phone, storedPasswordHash);

    if (!created || !created.affectedRows) {
      return { success: false };
    }

    return { success: true };
  } catch {
    return { success: false };
  }
};
