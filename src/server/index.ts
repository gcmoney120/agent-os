/**
 * Agent OS — API Layer: Server Entry Point
 *
 * Standalone entry point for running the Agent OS HTTP API server.
 *
 * Usage:
 *   AGENT_OS_API_KEY=sk-... tsx src/server/index.ts
 *
 * Environment variables:
 *   AGENT_OS_API_KEY      — API key for authentication (required)
 *   AGENT_OS_PORT         — Port to listen on (default: 3100)
 *   AGENT_OS_HOST         — Hostname to bind to (default: 127.0.0.1)
 *   ANTHROPIC_API_KEY     — Anthropic API key for LLM provider (optional)
 */

export { createAgentOSServer } from "./server.js";
export { ApiKeyAuth } from "./auth.js";
export type { AgentOSServerOptions } from "./server.js";
export type { ApiKeyEntry, AuthResult, AuthError, AuthOutcome } from "./auth.js";
export type {
  CreateRunRequest,
  ApiResponse,
  RunResponse,
  RunStatusResponse,
  RouteContext,
} from "./routes.js";
