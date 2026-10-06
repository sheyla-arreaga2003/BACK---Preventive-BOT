export type ChatRole = "user" | "assistant";

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

export interface ClientChatSession {
  motorcycleId: number;
  createdAt: string;
}

export type AdminChatTarget =
  | { type: "invoice"; serieInvoice: string; numberInvoice: string }
  | { type: "plate"; plate: string };

export interface MotorcycleSummary {
  brand: string;
  model: string;
  year: string;
  color: string;
  plate: string | null;
  latestPlateState: {
    id: number;
    name: string;
    registeredDate: string;
  } | null;
}

export interface MaintenancePage {
  maintenances: Array<{
    date: string;
    mileage: string | null;
    nextMileage: string | null;
    nextDate: string | null;
    services: Array<{ name: string; description: string }>;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: string;
}

export interface ModelTurn {
  status: string;
  text: string;
  toolCalls: ToolCallRequest[];
  continuation: unknown[];
  incompleteReason: string | null;
}

