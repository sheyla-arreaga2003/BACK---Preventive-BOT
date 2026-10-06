import { Router, type Request, type Router as ExpressRouter } from "express";
import crypto from "node:crypto";
import OpenAI from "openai";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { clientChatMiddleware } from "../middlewares/client-chat.middleware.js";
import { ChatModelIncompleteError } from "../services/chatbot-model.service.js";
import { resolveMotorcycleByInvoice, resolveMotorcycleByPlate } from "../services/chatbot-read.service.js";
import { chatbotService, validateChatInput } from "../services/chatbot.service.js";
import {
  clientSessionStore,
  hashRateLimitSubject,
} from "../services/chatbot-session.service.js";
import { rateLimitStore } from "../services/rate-limit.service.js";
import { redisKey } from "../config/redis.js";
import { chatbotConversationStore, type ChatbotConversationScope } from "../services/chatbot-conversation.service.js";
import type { AdminChatTarget, ChatHistoryMessage } from "../interfaces/chatbot.interface.js";

const router: ExpressRouter = Router();
const ADMIN_ROLE_ID = 1;
const INVOICE_ATTEMPT_LIMIT = 5;
const INVOICE_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const CHAT_REQUEST_LIMIT = 20;
const CHAT_REQUEST_WINDOW_SECONDS = 60;

function parseConversationId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(value)) {
    throw new TypeError("conversationId is invalid");
  }
  return value;
}

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}> {
  const result = await rateLimitStore.consume(key, limit, windowSeconds);
  return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
}

function parseTarget(value: unknown): AdminChatTarget | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("target is invalid");
  const record = value as Record<string, unknown>;
  if (record.type === "invoice") {
    if (typeof record.serieInvoice !== "string" || !record.serieInvoice.trim()
      || typeof record.numberInvoice !== "string" || !record.numberInvoice.trim()) {
      throw new TypeError("invoice target is invalid");
    }
    return { type: "invoice", serieInvoice: record.serieInvoice.trim(), numberInvoice: record.numberInvoice.trim() };
  }
  if (record.type === "plate") {
    if (typeof record.plate !== "string" || !record.plate.trim()) throw new TypeError("plate target is invalid");
    return { type: "plate", plate: record.plate.trim() };
  }
  throw new TypeError("target is invalid");
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (!secret) continue;
    result = result.split(secret).join("[identificador resuelto por el servidor]");
  }
  return result;
}

function redactChat(
  message: string,
  history: ChatHistoryMessage[],
  target: AdminChatTarget | null,
): { message: string; history: ChatHistoryMessage[] } {
  const values = target?.type === "invoice"
    ? [target.serieInvoice, target.numberInvoice]
    : target?.type === "plate" ? [target.plate] : [];
  return {
    message: redact(message, values),
    history: history.map((item) => ({ ...item, content: redact(item.content, values) })),
  };
}

function normalizedIdentifier(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function hasTargetConflict(message: string, target: AdminChatTarget | null): boolean {
  if (!target) return false;
  const plateMention = message.match(/\bplaca\s*(?:es|:|n[uú]mero)?\s*([a-z0-9-]{4,})/i)?.[1];
  const mentionsInvoice = /\b(factura|serie de factura|n[uú]mero de factura)\b/i.test(message);
  if (target.type === "invoice") return plateMention !== undefined;
  if (mentionsInvoice) return true;
  return plateMention !== undefined
    && normalizedIdentifier(plateMention) !== normalizedIdentifier(target.plate);
}

function sendChatError(res: import("express").Response, error: unknown): void {
  if (error instanceof TypeError || error instanceof RangeError) {
    res.status(400).json({ message: "Revisa el mensaje y los datos de la consulta" });
    return;
  }
  if (error instanceof ChatModelIncompleteError) {
    res.status(502).json({ message: "No fue posible preparar una respuesta en este momento" });
    return;
  }
  if (error instanceof OpenAI.APIError) {
    res.status(502).json({ message: "El asistente no está disponible temporalmente" });
    return;
  }
  res.status(503).json({ message: "No fue posible consultar la información en este momento" });
}

router.post("/client/session", async (req, res) => {
  try {
    const rate = await allowRequest(
      redisKey(`chatbot:rate:invoice:${hashRateLimitSubject(sourceIp(req))}`),
      INVOICE_ATTEMPT_LIMIT,
      INVOICE_ATTEMPT_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ message: "Demasiados intentos. Inténtalo más tarde" });
    }
    const { serieInvoice, numberInvoice } = req.body as Record<string, unknown>;
    if (typeof serieInvoice !== "string" || typeof numberInvoice !== "string") {
      return res.status(400).json({ message: "Serie y número de factura son obligatorios" });
    }
    const resolution = await resolveMotorcycleByInvoice(serieInvoice, numberInvoice);
    if (resolution.status === "not_found") return res.status(404).json({ message: "Motocicleta no encontrada" });
    if (resolution.status === "ambiguous") return res.status(409).json({ message: "La factura identifica más de una motocicleta" });
    const session = await clientSessionStore.create(resolution.motorcycleId);
    return res.status(201).json({ accessToken: session.credential, tokenType: "Client", expiresIn: session.expiresIn });
  } catch (error: unknown) {
    if (error instanceof TypeError) return res.status(400).json({ message: "Serie y número de factura no son válidos" });
    return res.status(503).json({ message: "No fue posible validar la factura en este momento" });
  }
});

router.delete("/client/session", clientChatMiddleware, async (req, res) => {
  try {
    await clientSessionStore.close(req.clientChatCredential ?? "");
    return res.status(204).send();
  } catch {
    return res.status(503).json({ message: "No fue posible cerrar la sesión de consulta" });
  }
});

router.post("/client/chat", clientChatMiddleware, async (req, res) => {
  try {
    const session = req.clientChatSession;
    if (!session) return res.status(401).json({ message: "Sesión de consulta inválida" });
    const rate = await allowRequest(
      redisKey(`chatbot:rate:client:${hashRateLimitSubject(req.clientChatCredential ?? "")}`),
      CHAT_REQUEST_LIMIT,
      CHAT_REQUEST_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ message: "Has alcanzado el límite temporal de consultas" });
    }
    const input = validateChatInput(req.body?.message, req.body?.history);
    const conversationId = parseConversationId(req.body?.conversationId);
    if (!conversationId) {
      const answer = await chatbotService.clientChat(session.motorcycleId, input.message, input.history);
      return res.json({ message: answer });
    }
    const scope: ChatbotConversationScope = {
      audience: "client",
      ownerId: fingerprint(req.clientChatCredential ?? ""),
      sessionId: fingerprint(req.clientChatCredential ?? ""),
      conversationId,
      targetFingerprint: fingerprint(`motorcycle:${session.motorcycleId}`),
    };
    const turn = await chatbotService.clientChatTurn(
      session.motorcycleId,
      input.message,
      input.history,
      await chatbotConversationStore.read(scope),
      scope.targetFingerprint,
    );
    if (turn.conversationState) await chatbotConversationStore.write(scope, turn.conversationState);
    else await chatbotConversationStore.clear(scope);
    return res.json({ message: turn.message });
  } catch (error: unknown) {
    sendChatError(res, error);
  }
});

router.post("/admin/chat", authMiddleware, authorizeRoles(ADMIN_ROLE_ID), async (req, res) => {
  try {
    if (!req.auth) return res.status(401).json({ message: "Unauthorized" });
    const rate = await allowRequest(
      redisKey(`chatbot:rate:admin:${req.auth.user.id}:${hashRateLimitSubject(sourceIp(req))}`),
      CHAT_REQUEST_LIMIT,
      CHAT_REQUEST_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ message: "Has alcanzado el límite temporal de consultas" });
    }
    const target = parseTarget(req.body?.target);
    let motorcycleId: number | null = null;
    if (target) {
      const resolution = target.type === "invoice"
        ? await resolveMotorcycleByInvoice(target.serieInvoice, target.numberInvoice)
        : await resolveMotorcycleByPlate(target.plate);
      if (resolution.status === "not_found") return res.status(404).json({ message: "Motocicleta no encontrada" });
      if (resolution.status === "ambiguous") return res.status(409).json({ message: "El identificador corresponde a más de una motocicleta" });
      motorcycleId = resolution.motorcycleId;
    }
    const input = validateChatInput(req.body?.message, req.body?.history);
    const conversationId = parseConversationId(req.body?.conversationId);
    const targetConflict = hasTargetConflict(input.message, target);
    const safeInput = redactChat(input.message, input.history, target);
    if (!conversationId) {
      const answer = await chatbotService.adminChat(motorcycleId, safeInput.message, safeInput.history, { targetConflict });
      return res.json({ message: answer });
    }
    const targetFingerprint = fingerprint(target === null ? "general" : JSON.stringify(target));
    const scope: ChatbotConversationScope = {
      audience: "admin",
      ownerId: String(req.auth.user.id),
      sessionId: req.auth.session.id,
      conversationId,
      targetFingerprint,
    };
    const storedState = await chatbotConversationStore.read(scope)
      ?? await chatbotConversationStore.readPendingMotorcycleTransition(scope);
    const turn = await chatbotService.adminChatTurn(
      motorcycleId,
      safeInput.message,
      safeInput.history,
      storedState,
      targetFingerprint,
      { targetConflict },
    );
    if (turn.conversationState) await chatbotConversationStore.write(scope, turn.conversationState);
    else await chatbotConversationStore.clear(scope);
    return res.json({ message: turn.message });
  } catch (error: unknown) {
    sendChatError(res, error);
  }
});

router.delete("/admin/conversation/:conversationId", authMiddleware, authorizeRoles(ADMIN_ROLE_ID), async (req, res) => {
  try {
    if (!req.auth) return res.status(401).json({ message: "Unauthorized" });
    const conversationId = parseConversationId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ message: "Revisa la conversación seleccionada" });
    const scope: ChatbotConversationScope = {
      audience: "admin",
      ownerId: String(req.auth.user.id),
      sessionId: req.auth.session.id,
      conversationId,
      targetFingerprint: "reset",
    };
    await chatbotConversationStore.clear(scope);
    return res.status(204).send();
  } catch (error: unknown) {
    sendChatError(res, error);
  }
});

export default router;
