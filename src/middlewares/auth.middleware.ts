import jwt, { type JwtPayload } from "jsonwebtoken";
import { redisClient } from "../config/redis.js";
import type { NextFunction, Request, Response } from "express";

interface SessionData {
    userId: number;
    email: string;
}

interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
    };
}

function isSessionData(value: unknown): value is SessionData {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const session = value as Record<string, unknown>;
    return typeof session.userId === "number" && typeof session.email === "string";
}

export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try{
        const authHeader = req.headers.authorization;

        const [type, token] = authHeader ? authHeader.split(" ") : [null, null];

        if (!(type === "Bearer" && token)) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const decoded: string | JwtPayload = jwt.verify(
            token,
            process.env.JWT_SECRET || 'default_secret',
        );

        if (typeof decoded === "string" || typeof decoded.sid !== "string") {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const session = await redisClient.get(`session:${decoded.sid}`);

        if (!session) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const sessionData: unknown = JSON.parse(session);

        if (!isSessionData(sessionData)) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        req.user = {
            id: sessionData.userId,
            email: sessionData.email,
        };

        next();
    } catch {
        return res.status(401).json({ message: "Unauthorized" });
    }
};
