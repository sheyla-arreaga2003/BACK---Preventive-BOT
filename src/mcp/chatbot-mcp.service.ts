import { randomUUID } from "node:crypto";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolCallRequest } from "../interfaces/chatbot.interface.js";
import type { ToolExecutionOutput } from "../services/chatbot-model.service.js";

const emptyInput = z.object({}).strict();
const paginatedInput = z.object({
  page: z.number().int().positive().max(100_000),
  pageSize: z.number().int().positive().max(20),
}).strict();
const periodInput = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
const documentInput = z.object({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().positive().max(8),
}).strict();
const customerSearchInput = z.object({
  query: z.string().trim().min(1).max(120),
  page: z.number().int().positive().max(100_000),
  pageSize: z.number().int().positive().max(20),
}).strict();
const customerDetailInput = z.object({
  query: z.string().trim().min(1).max(120).nullable(),
  customerId: z.number().int().positive().nullable(),
  page: z.number().int().positive().max(100_000),
  pageSize: z.number().int().positive().max(20),
}).strict().refine((value) => (value.query === null) !== (value.customerId === null));
const toolOutput = z.object({ payload: z.string() }).strict();

export type ChatbotMcpToolName =
  | "get_motorcycle_overview"
  | "get_motorcycle_summary"
  | "get_maintenance_history"
  | "get_next_maintenance"
  | "get_pending_plates"
  | "get_motorcycle_fleet_summary"
  | "get_maintenance_period_summary"
  | "get_customer_summary"
  | "search_customers"
  | "get_customer_detail"
  | "get_motorcycle_list"
  | "get_plate_history"
  | "get_service_catalog"
  | "get_spare_parts_catalog"
  | "get_users_roles"
  | "get_reminder_list"
  | "get_dashboard_summary"
  | "search_approved_documents";

export class ChatbotMcpError extends Error {
  constructor(message = "La consulta interna no pudo completarse") {
    super(message);
  }
}

function schemaFor(name: ChatbotMcpToolName) {
  if (["get_motorcycle_overview", "get_maintenance_history", "get_pending_plates", "get_motorcycle_list", "get_service_catalog", "get_spare_parts_catalog", "get_users_roles", "get_reminder_list"].includes(name)) return paginatedInput;
  if (name === "search_customers") return customerSearchInput;
  if (name === "get_customer_detail") return customerDetailInput;
  if (name === "get_maintenance_period_summary") return periodInput;
  if (name === "search_approved_documents") return documentInput;
  return emptyInput;
}

function readTextContent(value: unknown): string {
  if (typeof value !== "object" || value === null) throw new ChatbotMcpError();
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new ChatbotMcpError();
  const text = content.find((item): item is { type: "text"; text: string } => (
    typeof item === "object" && item !== null
      && (item as { type?: unknown }).type === "text"
      && typeof (item as { text?: unknown }).text === "string"
  ));
  if (!text) throw new ChatbotMcpError();
  return text.text;
}

function readStructuredPayload(value: unknown): string {
  if (typeof value !== "object" || value === null) throw new ChatbotMcpError();
  const structured = (value as { structuredContent?: unknown }).structuredContent;
  if (typeof structured !== "object" || structured === null || Array.isArray(structured)) throw new ChatbotMcpError();
  const payload = (structured as { payload?: unknown }).payload;
  if (typeof payload !== "string") throw new ChatbotMcpError();
  return payload;
}

function parseExecutionOutput(value: string): ToolExecutionOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ChatbotMcpError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ChatbotMcpError();
  const record = parsed as Record<string, unknown>;
  if (!("modelData" in record)) throw new ChatbotMcpError();
  if (record.deterministicText !== undefined && typeof record.deterministicText !== "string") {
    throw new ChatbotMcpError();
  }
  return record.deterministicText === undefined
    ? { modelData: record.modelData }
    : { modelData: record.modelData, deterministicText: record.deterministicText };
}

export async function withScopedChatbotMcp<T>(
  allowedTools: readonly ChatbotMcpToolName[],
  handler: (call: ToolCallRequest) => Promise<ToolExecutionOutput>,
  operation: (execute: (call: ToolCallRequest) => Promise<ToolExecutionOutput>) => Promise<T>,
): Promise<T> {
  const server = new McpServer({ name: "preventive-bot-readonly", version: "1.0.0" });
  for (const name of allowedTools) {
    server.registerTool(name, {
      description: "Consulta interna de solo lectura autorizada para esta solicitud.",
      inputSchema: schemaFor(name),
      outputSchema: toolOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input) => {
      const output = await handler({ callId: randomUUID(), name, arguments: JSON.stringify(input) });
      const payload = JSON.stringify(output);
      return { content: [{ type: "text", text: payload }], structuredContent: { payload } };
    });
  }

  const client = new Client({ name: "preventive-bot-chatbot", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await operation(async (call) => {
      if (!allowedTools.includes(call.name as ChatbotMcpToolName)) throw new ChatbotMcpError("Consulta no autorizada");
      const result = await client.callTool({ name: call.name, arguments: JSON.parse(call.arguments) as Record<string, unknown> });
      if (result.isError) throw new ChatbotMcpError(readTextContent(result));
      return parseExecutionOutput(readStructuredPayload(result));
    });
  } finally {
    await client.close();
    await server.close();
  }
}
