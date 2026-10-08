import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuthenticatedUserById } from "../services/database.service.js";
import type { AuthenticatedUserRow } from "../interfaces/database.interface.js";
import { validateToken, type TokenResult } from "../services/auth.service.js";

export interface AuthIdentity {
  user: {
    id: number;
    name: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  session: { id: string };
  role: { id: number | null };
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthIdentity;
    }
  }
}

type TokenValidator = (token: string) => Promise<TokenResult>;
type AuthenticatedUser = Pick<AuthenticatedUserRow, "USId" | "USName" | "USLastName" | "USEmail" | "USPhone" | "ROIdRol">;
type UserLoader = (userId: number) => Promise<AuthenticatedUser | null>;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  return parts.length === 2 && parts[0] === "Bearer" && parts[1] ? parts[1] : null;
}

export function createAuthMiddleware(tokenValidator: TokenValidator, userLoader: UserLoader): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const tokenResult = await tokenValidator(token);
    if (!tokenResult.success) {
      if (tokenResult.reason === "session_store_unavailable") {
        return res.status(503).json({ message: "Authentication service unavailable" });
      }
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const user = await userLoader(tokenResult.userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      req.auth = {
        user: {
          id: user.USId,
          name: user.USName,
          lastName: user.USLastName,
          email: user.USEmail,
          phone: user.USPhone,
        },
        session: { id: tokenResult.sessionid },
        role: { id: user.ROIdRol },
      };
      return next();
    } catch {
      return res.status(503).json({ message: "Authentication service unavailable" });
    }
  };
}

export const authMiddleware: RequestHandler = createAuthMiddleware(validateToken, getAuthenticatedUserById);

export function authorizeRoles(...allowedRoleIds: readonly number[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ message: "Unauthorized" });
    if (req.auth.role.id === null || !allowedRoleIds.includes(req.auth.role.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}
