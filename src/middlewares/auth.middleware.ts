import jwt from "jsonwebtoken";
import { redisClient } from "../config/redis.js";

export const authMiddleware = async (req: any, res: any, next: any) => {
    try{
        const authHeader = req.headers.authorization;

        const [type, token] = authHeader ? authHeader.split(" ") : [null, null];

        if (!(type === "Bearer" && token)) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const decoded : any = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');

        const session = await redisClient.get(`session:${decoded.sid}`);

        if (!session) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const sessionData = JSON.parse(session);

        req.user = {
            id: sessionData.userId,
            username: sessionData.username,
            ...sessionData
        };

        next();
    } catch (error) {
        return res.status(401).json({ message: "Unauthorized" });
    }
};