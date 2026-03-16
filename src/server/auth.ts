/**
 * Agent OS — API Layer: Authentication Middleware
 *
 * API key authentication for the HTTP server.
 * Keys are provided at server startup — no external auth service dependency.
 *
 * Auth model:
 *   - Bearer token in Authorization header
 *   - Tokens are opaque API keys configured at server startup
 *   - Each key maps to a principal identity (for audit trail)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface ApiKeyEntry {
  /** The API key value (compared against Bearer token). */
  key: string;
  /** Human-readable label for this key (e.g., "ci-pipeline", "admin"). */
  label: string;
  /** Principal identity recorded in audit trail. */
  principal: string;
  /** Optional: restrict to specific actions. Empty = all allowed. */
  allowedActions?: string[];
}

export interface AuthResult {
  ok: true;
  principal: string;
  label: string;
  allowedActions: string[];
}

export interface AuthError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type AuthOutcome = AuthResult | AuthError;

// ── Auth Middleware ──────────────────────────────────────────────────────────

export class ApiKeyAuth {
  private readonly keys: Map<string, ApiKeyEntry>;

  constructor(entries: ApiKeyEntry[]) {
    this.keys = new Map();
    for (const entry of entries) {
      if (this.keys.has(entry.key)) {
        throw new Error(`ApiKeyAuth: duplicate API key for label "${entry.label}"`);
      }
      this.keys.set(entry.key, entry);
    }
  }

  /**
   * Authenticate a request by extracting the Bearer token from the
   * Authorization header and validating it against configured keys.
   */
  authenticate(authorizationHeader: string | undefined): AuthOutcome {
    if (!authorizationHeader) {
      return {
        ok: false,
        status: 401,
        code: "AUTH_MISSING",
        message: "Authorization header required. Use: Authorization: Bearer <api-key>",
      };
    }

    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return {
        ok: false,
        status: 401,
        code: "AUTH_MALFORMED",
        message: "Authorization header must use Bearer scheme.",
      };
    }

    const token = match[1];
    const entry = this.keys.get(token);
    if (!entry) {
      return {
        ok: false,
        status: 403,
        code: "AUTH_INVALID_KEY",
        message: "Invalid API key.",
      };
    }

    return {
      ok: true,
      principal: entry.principal,
      label: entry.label,
      allowedActions: entry.allowedActions ?? [],
    };
  }

  /**
   * Check if the authenticated principal is allowed to perform an action.
   * Empty allowedActions means all actions are permitted.
   */
  static isActionAllowed(auth: AuthResult, action: string): boolean {
    if (auth.allowedActions.length === 0) return true;
    return auth.allowedActions.includes(action);
  }
}
