import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ClientChatSession } from "../interfaces/chatbot.interface.js";
import { clientSessionStore, type ClientSessionStore } from "../services/chatbot-session.service.js";

declare global {
  namespace Express {
    interface Request {
      clientChatSession?: ClientChatSession;
      clientChatCredential?: string;
    }
  }
}

function extractClientCredential(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  return parts.length === 2 && parts[0] === "Client" && parts[1] ? parts[1] : null;
}

export function createClientChatMiddleware(store: ClientSessionStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const credential = extractClientCredential(req.headers.authorization);
    if (!credential) return res.status(401).json({ message: "Sesión de consulta inválida" });
    try {
      const session = await store.read(credential);
      if (!session) return res.status(401).json({ message: "Sesión de consulta inválida o vencida" });
      req.clientChatSession = session;
      req.clientChatCredential = credential;
      return next();
    } catch {
      return res.status(503).json({ message: "El servicio de sesiones no está disponible" });
    }
  };
}

export const clientChatMiddleware: RequestHandler = createClientChatMiddleware(clientSessionStore);
