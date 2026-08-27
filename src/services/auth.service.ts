// LOGIN SERVICE
import { getUserByUsername, addUser } from './database.service.js';
import crypto from 'crypto';
import jwt from "jsonwebtoken";
import { redisClient } from '../config/redis.js';

export const validateLogin = async (username: string, password: string): Promise<any> => {
  try {
    const user = await getUserByUsername(username);
    
    if (!user || user.length === 0) {
      return { success: false };
    }

    const storedPasswordHash = user[0].USPassword;
    const inputPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (storedPasswordHash !== inputPasswordHash) {
      return { success: false };
    }

    if (!(storedPasswordHash === inputPasswordHash)) {
      return { success: false };
    }

    const sessionid = crypto.randomUUID().toString();

    const expires = 60 * 60 * 4;

    await redisClient.set(`session:${sessionid}`, JSON.stringify({ userId: user[0].USIdUser, username: user[0].USUsername }), { EX: expires });

    const token = jwt.sign({ sub: user[0].USIdUser, sid: user[0].USUsername }, process.env.JWT_SECRET || 'default_secret', { expiresIn: expires });

    return { success: true, sessionid, token };
  } catch (error) {
    return { success: false };
  }
};

export const validateToken = async (token: string): Promise<any> => {
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');

    if (!decoded || !decoded.sub || !decoded.sid) {
      return { success: false };
    }
    
    return { success: true, userId: decoded.sub, username: decoded.sid };
  } catch (error) {
    return { success: false };
  }
};

export const logout = async (sessionid: string): Promise<any> => {
  try {
    await redisClient.del(`session:${sessionid}`);

    return { success: true };
  } catch (error) {
    return { success: false };
  }
};

export const signup = async (name: string, rol: string, lastname: string, email: string, phone: string, password: string): Promise<any> => {
  try {
    const storedPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
    const created = await addUser(name, rol, lastname, email, phone, storedPasswordHash);

    if (!created || !created.affectedRows) {
      return { success: false };
    }

    return { success: true };
  } catch (error) {
    return { success: false };
  }
};