import { redisClient, redisKey } from "../config/redis.js";
import type { CapabilityId } from "./chatbot-capabilities.service.js";

export const CHATBOT_CONVERSATION_TTL_SECONDS = 30 * 60;

export type MissingConversationData =
  | "date_range"
  | "motorcycle"
  | "maintenance_scope"
  | "motorcycle_scope"
  | "request_details";

export interface ChatbotConversationState {
  audience: "client" | "admin";
  targetFingerprint: string;
  activeCapabilityId: CapabilityId | null;
  pending: {
    capabilityId: CapabilityId | null;
    missing: MissingConversationData;
  } | null;
  confirmed: {
    startDate?: string;
    endDate?: string;
    query?: string;
    customerId?: number;
    customerCandidates?: Array<{ customerId: number }>;
  };
  updatedAt: string;
}

export interface ChatbotConversationScope {
  audience: "client" | "admin";
  ownerId: string;
  sessionId: string;
  conversationId: string;
  targetFingerprint: string;
}

export interface ConversationRedis {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

function storageKey(scope: ChatbotConversationScope): string {
  return redisKey(`chatbot:conversation:${scope.audience}:${scope.ownerId}:${scope.sessionId}:${scope.conversationId}`);
}

function parseState(value: string): ChatbotConversationState | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if ((record.audience !== "client" && record.audience !== "admin")
      || typeof record.targetFingerprint !== "string"
      || typeof record.updatedAt !== "string"
      || typeof record.confirmed !== "object" || record.confirmed === null
      || (record.activeCapabilityId !== null && typeof record.activeCapabilityId !== "string")) return null;
    const pending = record.pending;
    if (pending !== null && (typeof pending !== "object" || Array.isArray(pending))) return null;
    return parsed as ChatbotConversationState;
  } catch {
    return null;
  }
}

export function createChatbotConversationStore(redis: ConversationRedis) {
  return {
    async read(scope: ChatbotConversationScope): Promise<ChatbotConversationState | null> {
      const value = await redis.get(storageKey(scope));
      if (!value) return null;
      const state = parseState(value);
      if (!state || state.audience !== scope.audience || state.targetFingerprint !== scope.targetFingerprint) return null;
      return state;
    },
    async readPendingMotorcycleTransition(scope: ChatbotConversationScope): Promise<ChatbotConversationState | null> {
      const value = await redis.get(storageKey(scope));
      if (!value) return null;
      const state = parseState(value);
      if (!state || state.audience !== scope.audience || state.pending?.missing !== "motorcycle") return null;
      return state;
    },
    async write(scope: ChatbotConversationScope, state: ChatbotConversationState): Promise<void> {
      await redis.set(storageKey(scope), JSON.stringify(state), { EX: CHATBOT_CONVERSATION_TTL_SECONDS });
    },
    async clear(scope: ChatbotConversationScope): Promise<void> {
      await redis.del(storageKey(scope));
    },
  };
}

export const chatbotConversationStore = createChatbotConversationStore(redisClient);
