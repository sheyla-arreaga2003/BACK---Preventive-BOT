import { logout, signup, validateLogin, validateToken } from "../services/auth.service.js";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";

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
            return res.status(401).json({ message: "User or password incorrect" });
        }
        
        return res.status(200).json({ message: "Login successful", sessionid: validated.sessionid, token: validated.token });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/logout", async (req: Request, res: Response) => {
    try {
        const validated = await validateToken(req.headers.authorization ?.split(" ")[1] || "");

        if (!validated || !validated.success) {
            return res.status(400).json({ message: "Invalid token" });
        }

        const closed = await logout(validated.sessionid);

        if (!closed.success) {
            return res.status(500).json({ message: "Internal server error" });
        }
        
        return res.status(200).json({ message: "Logout successful" });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
});

router.post("/signup", async (req: Request<Record<string, never>, unknown, SignupBody>, res: Response) => {
    try {
        const { name, rol, lastname, email, phone, password } = req.body;
        const created = await signup(name, rol, lastname, email, phone, password);

        if (!created || !created.success) {
            return res.status(400).json({ message: "Signup failed" });
        }

        return res.status(200).json({ message: "Signup successful" });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
