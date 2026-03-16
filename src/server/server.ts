/**
 * Agent OS — API Layer: HTTP Server
 *
 * Lightweight HTTP server using Node's built-in http module.
 * No external framework dependencies.
 *
 * Wraps the runtime executeRun function with:
 *   - API key authentication
 *   - JSON request/response handling
 *   - Route matching
 *   - Request logging
 *   - Error boundaries
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

import { ApiKeyAuth, type ApiKeyEntry, type AuthResult } from "./auth.js";
import {
  handleCreateRun,
  handleGetRunStatus,
  handleHealthCheck,
  type RouteContext,
  type ApiResponse,
} from "./routes.js";
import type { ProviderOverrides } from "../runtime/compose.js";
import type { RunLedgerStore } from "../planner/run-ledger.js";
import { createEmptyLedgerStore } from "../planner/run-ledger.js";

// ── Server Options ──────────────────────────────────────────────────────────

export interface AgentOSServerOptions {
  /** Port to listen on. Defaults to 3100. */
  port?: number;
  /** Hostname to bind to. Defaults to "127.0.0.1". */
  host?: string;
  /** API keys for authentication. At least one required. */
  apiKeys: ApiKeyEntry[];
  /** Provider overrides for executeRun. */
  providers?: Partial<ProviderOverrides>;
  /** Request logging function. Defaults to console.log. */
  log?: (message: string) => void;
}

// ── Request Helpers ─────────────────────────────────────────────────────────

function parseUrl(req: IncomingMessage): { pathname: string; params: Record<string, string> } {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return { pathname: url.pathname, params: {} };
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 10 * 1024 * 1024; // 10MB limit

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

// ── Route Matching ──────────────────────────────────────────────────────────

interface RouteMatch {
  handler: string;
  params: Record<string, string>;
}

function matchRoute(method: string, pathname: string): RouteMatch | null {
  // Health check (no auth required)
  if (method === "GET" && pathname === "/api/v1/health") {
    return { handler: "health", params: {} };
  }

  // Create run
  if (method === "POST" && pathname === "/api/v1/runs") {
    return { handler: "createRun", params: {} };
  }

  // Get run status
  const runStatusMatch = pathname.match(/^\/api\/v1\/runs\/([A-Za-z0-9_-]+)$/);
  if (method === "GET" && runStatusMatch) {
    return { handler: "getRunStatus", params: { id: runStatusMatch[1] } };
  }

  return null;
}

// ── Server ──────────────────────────────────────────────────────────────────

/**
 * Create and start the Agent OS HTTP server.
 *
 * Usage:
 *   const server = await createAgentOSServer({
 *     apiKeys: [{ key: "sk-...", label: "admin", principal: "admin@example.com" }],
 *     providers: { llm: new AnthropicLLMProvider({ apiKey: "..." }) },
 *   });
 *
 *   // Later:
 *   server.close();
 */
export async function createAgentOSServer(
  options: AgentOSServerOptions,
): Promise<Server> {
  const port = options.port ?? 3100;
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? console.log;
  const auth = new ApiKeyAuth(options.apiKeys);

  // Mutable ledger store — updated after each run
  let ledgerStore: RunLedgerStore = createEmptyLedgerStore();

  const routeCtx: RouteContext = {
    providers: options.providers,
    getLedgerStore: () => ledgerStore,
    setLedgerStore: (store) => { ledgerStore = store; },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const startTime = Date.now();
    const method = req.method ?? "GET";
    const { pathname } = parseUrl(req);

    try {
      // Route matching
      const route = matchRoute(method, pathname);
      if (!route) {
        sendError(res, 404, "NOT_FOUND", `No route for ${method} ${pathname}`);
        log(`${method} ${pathname} → 404 (${Date.now() - startTime}ms)`);
        return;
      }

      // Health check — no auth required
      if (route.handler === "health") {
        const result = handleHealthCheck();
        sendJson(res, result.status, result.body);
        log(`${method} ${pathname} → ${result.status} (${Date.now() - startTime}ms)`);
        return;
      }

      // Authenticate
      const authResult = auth.authenticate(req.headers.authorization);
      if (!authResult.ok) {
        sendError(res, authResult.status, authResult.code, authResult.message);
        log(`${method} ${pathname} → ${authResult.status} AUTH_FAILED (${Date.now() - startTime}ms)`);
        return;
      }

      // Dispatch to handler
      let handlerResult: { status: number; body: ApiResponse };

      switch (route.handler) {
        case "createRun": {
          const bodyStr = await readBody(req);
          let body: unknown;
          try {
            body = JSON.parse(bodyStr);
          } catch {
            sendError(res, 400, "INVALID_JSON", "Request body must be valid JSON.");
            log(`${method} ${pathname} → 400 INVALID_JSON (${Date.now() - startTime}ms)`);
            return;
          }
          handlerResult = await handleCreateRun(body, authResult, routeCtx);
          break;
        }

        case "getRunStatus": {
          handlerResult = handleGetRunStatus(route.params.id, authResult, routeCtx);
          break;
        }

        default:
          sendError(res, 500, "INTERNAL_ERROR", "Unhandled route.");
          log(`${method} ${pathname} → 500 UNHANDLED (${Date.now() - startTime}ms)`);
          return;
      }

      sendJson(res, handlerResult.status, handlerResult.body);
      log(`${method} ${pathname} → ${handlerResult.status} [${authResult.label}] (${Date.now() - startTime}ms)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error.");
      log(`${method} ${pathname} → 500 ERROR: ${message} (${Date.now() - startTime}ms)`);
    }
  });

  return new Promise<Server>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      log(`Agent OS API server listening on http://${host}:${port}`);
      log(`Routes: POST /api/v1/runs, GET /api/v1/runs/:id, GET /api/v1/health`);
      resolve(server);
    });
  });
}
