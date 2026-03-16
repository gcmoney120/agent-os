/**
 * Agent OS — Runtime Integration Layer
 * Anthropic LLM Provider: real Claude API implementation of LLMProvider.
 *
 * Implements the LLMProvider interface by calling the Anthropic Messages API.
 * Uses fetch directly — no SDK dependency required.
 *
 * Configuration:
 *   - ANTHROPIC_API_KEY environment variable (required)
 *   - Optional base URL override via constructor
 */

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  LLMToolDefinition,
  LLMToolCall,
} from "./providers.js";

// ── Types for Anthropic Messages API ────────────────────────────────────────

interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  temperature?: number;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

// ── Provider Options ────────────────────────────────────────────────────────

export interface AnthropicLLMProviderOptions {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Base URL for the API. Defaults to https://api.anthropic.com */
  baseUrl?: string;
  /** API version header. Defaults to 2023-06-01. */
  apiVersion?: string;
  /** Request timeout in milliseconds. Defaults to 120000 (2 minutes). */
  timeoutMs?: number;
}

// ── AnthropicLLMProvider ────────────────────────────────────────────────────

export class AnthropicLLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(options: AnthropicLLMProviderOptions = {}) {
    const apiKey = options.apiKey;
    if (!apiKey) {
      throw new Error(
        "AnthropicLLMProvider: apiKey option is required.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? "2023-06-01";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const body: AnthropicMessageRequest = {
      model: request.model,
      max_tokens: request.max_tokens,
      messages: request.messages.map(toAnthropicMessage),
    };

    if (request.system) {
      body.system = request.system;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toAnthropicTool);
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`AnthropicLLMProvider: request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`AnthropicLLMProvider: fetch failed: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as AnthropicErrorResponse;
        errorMessage = `${parsed.error.type}: ${parsed.error.message}`;
      } catch {
        errorMessage = errorBody;
      }
      throw new Error(
        `AnthropicLLMProvider: API returned ${response.status}: ${errorMessage}`,
      );
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    return fromAnthropicResponse(data);
  }
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

function toAnthropicMessage(msg: LLMMessage): AnthropicMessage {
  return { role: msg.role, content: msg.content };
}

function toAnthropicTool(tool: LLMToolDefinition): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

function fromAnthropicResponse(data: AnthropicMessageResponse): LLMResponse {
  // Extract text content
  const textBlocks = data.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text);
  const content = textBlocks.join("");

  // Extract tool calls
  const toolUseBlocks = data.content.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      b.type === "tool_use",
  );

  const toolCalls: LLMToolCall[] | undefined =
    toolUseBlocks.length > 0
      ? toolUseBlocks.map((b) => ({
          id: b.id,
          name: b.name,
          input: b.input,
        }))
      : undefined;

  return {
    content,
    model: data.model,
    usage: {
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
    },
    stop_reason: data.stop_reason,
    tool_calls: toolCalls,
  };
}
