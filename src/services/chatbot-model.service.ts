import OpenAI from "openai";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { env } from "../config/env.js";
import type { ChatHistoryMessage, ToolCallRequest } from "../interfaces/chatbot.interface.js";

export const CHAT_MAX_OUTPUT_TOKENS = 512;
export const CHAT_MAX_TOOL_CALLS = 1;

export interface ChatModelRequest {
  instructions: string;
  history: ChatHistoryMessage[];
  message: string;
  tools: FunctionTool[];
}

export interface ToolExecutionOutput {
  modelData: unknown;
  deterministicText?: string;
}

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatModelResult {
  text: string;
  usage: ChatTokenUsage | null;
  responseCalls: number;
}

export type ToolExecutor = (call: ToolCallRequest) => Promise<ToolExecutionOutput>;

export interface ChatModelGateway {
  generate(request: ChatModelRequest, executeTool: ToolExecutor): Promise<ChatModelResult | string>;
}

export class ChatModelIncompleteError extends Error {
  constructor(public readonly reason: string) {
    super("The model response was incomplete");
  }
}

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 30_000,
  maxRetries: 0,
});

interface ModelApiResponse {
  status?: string;
  output: ResponseOutputItem[];
  output_text: string;
  incomplete_details?: { reason?: string } | null;
  usage?: ResponseUsage | null;
}

export interface ResponsesCreator {
  create(parameters: ResponseCreateParamsNonStreaming): Promise<ModelApiResponse>;
}

function messages(request: ChatModelRequest): ResponseInputItem[] {
  return [
    ...request.history.map((item): ResponseInputItem => ({ role: item.role, content: item.content })),
    { role: "user", content: request.message },
  ];
}

function functionCalls(output: readonly unknown[]): ResponseFunctionToolCall[] {
  return output.filter((item): item is ResponseFunctionToolCall => {
    return typeof item === "object" && item !== null && (item as { type?: unknown }).type === "function_call";
  });
}

function continuationItems(output: readonly ResponseOutputItem[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  for (const item of output) {
    if (item.type === "reasoning" || item.type === "function_call") items.push(item);
  }
  return items;
}

function addUsage(first?: ResponseUsage | null, second?: ResponseUsage | null): ChatTokenUsage | null {
  if (!first && !second) return null;
  return {
    inputTokens: (first?.input_tokens ?? 0) + (second?.input_tokens ?? 0),
    outputTokens: (first?.output_tokens ?? 0) + (second?.output_tokens ?? 0),
    totalTokens: (first?.total_tokens ?? 0) + (second?.total_tokens ?? 0),
  };
}

export function createOpenAIChatModelGateway(responses: ResponsesCreator): ChatModelGateway {
  return {
  async generate(request, executeTool) {
    const first = await responses.create({
      model: env.OPENAI_MODEL,
      instructions: request.instructions,
      input: messages(request),
      tools: request.tools,
      tool_choice: "required",
      parallel_tool_calls: false,
      max_output_tokens: CHAT_MAX_OUTPUT_TOKENS,
      reasoning: { effort: "minimal" },
      include: ["reasoning.encrypted_content"],
      store: false,
    });

    if (first.status === "incomplete") {
      throw new ChatModelIncompleteError(first.incomplete_details?.reason ?? "unknown");
    }
    const calls = functionCalls(first.output);
    if (calls.length === 0) {
      throw new ChatModelIncompleteError("required_tool_not_called");
    }
    if (calls.length > CHAT_MAX_TOOL_CALLS) throw new ChatModelIncompleteError("tool_call_limit");

    const toolOutputs: ResponseInputItem[] = [];
    for (const call of calls) {
      const result = await executeTool({ callId: call.call_id, name: call.name, arguments: call.arguments });
      if (result.deterministicText !== undefined) {
        return { text: result.deterministicText, usage: addUsage(first.usage), responseCalls: 1 };
      }
      toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result.modelData) });
    }

    const second = await responses.create({
      model: env.OPENAI_MODEL,
      instructions: request.instructions,
      input: [...messages(request), ...continuationItems(first.output), ...toolOutputs],
      tools: request.tools,
      tool_choice: "none",
      max_output_tokens: CHAT_MAX_OUTPUT_TOKENS,
      reasoning: { effort: "minimal" },
      store: false,
    });
    if (second.status === "incomplete") {
      throw new ChatModelIncompleteError(second.incomplete_details?.reason ?? "unknown");
    }
    const text = second.output_text.trim();
    if (!text) throw new ChatModelIncompleteError("empty_output");
    return { text, usage: addUsage(first.usage, second.usage), responseCalls: 2 };
  },
  };
}

export const openAIChatModelGateway: ChatModelGateway = createOpenAIChatModelGateway(client.responses);
