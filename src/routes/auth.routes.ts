import { logout, validateLogin } from "../services/auth.service.js";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router: ExpressRouter = Router();

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

        const validated = await validateLogin(email, password);

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
        return res.status(500).json({ message: "Internal server error" });
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
