import { logout, validateLogin } from "../services/auth.service.js";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { rateLimitStore } from "../services/rate-limit.service.js";
import { hashRateLimitSubject } from "../services/chatbot-session.service.js";
import { redisKey } from "../config/redis.js";

const router: ExpressRouter = Router();
const LOGIN_IP_LIMIT = 30;
const LOGIN_ACCOUNT_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

interface LoginBody {
    email: string;
    password: string;
}

interface SignupBody {
    name: string;
    rol: number;
    lastname: string;
    email: string;
    phone: string;
    password: string;
}

router.post("/login", async (req: Request<Record<string, never>, unknown, LoginBody>, res: Response) => {
    try{
        const { email, password } = req.body;

        if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const ipSubject = hashRateLimitSubject(req.ip || req.socket.remoteAddress || "unknown");
        const accountSubject = hashRateLimitSubject(email.trim().toLowerCase());
        const [ipRate, accountRate] = await Promise.all([
            rateLimitStore.consume(redisKey(`auth:rate:ip:${ipSubject}`), LOGIN_IP_LIMIT, LOGIN_WINDOW_SECONDS),
            rateLimitStore.consume(redisKey(`auth:rate:account:${accountSubject}`), LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW_SECONDS),
        ]);
        if (!ipRate.allowed || !accountRate.allowed) {
            const retryAfter = Math.max(ipRate.retryAfterSeconds, accountRate.retryAfterSeconds);
            res.setHeader("Retry-After", String(retryAfter));
            return res.status(429).json({ message: "Demasiados intentos. Inténtalo nuevamente más tarde" });
        }

        const validated = await validateLogin(email.trim().toLowerCase(), password, req.get("user-agent") ?? "");

        if (!validated || !validated.success) {
            if (validated?.reason === "database_unavailable" || validated?.reason === "session_store_unavailable") {
                return res.status(503).json({ message: "Authentication service unavailable" });
            }
            return res.status(401).json({ message: "User or password incorrect" });
        }
        
        return res.status(200).json({
            message: "Login successful",
            sessionid: validated.sessionid,
            token: validated.token,
            USName: validated.USName,
        });
    } catch (error) {
        return res.status(503).json({ message: "Authentication service unavailable" });
    }
});

router.post("/logout", authMiddleware, async (req: Request, res: Response) => {
    try {
        const closed = await logout(req.auth!.session.id);

        if (!closed.success) {
            return res.status(500).json({ message: "Internal server error" });
        }
        
        return res.status(200).json({ message: "Logout successful" });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/signup", authMiddleware, async (req: Request<Record<string, never>, unknown, SignupBody>, res: Response) => {
    return res.status(403).json({ message: "User provisioning policy is not configured" });
});

export default router;
