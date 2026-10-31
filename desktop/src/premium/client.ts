import type {
  EntitlementView,
  PremiumSubscriptionView,
  PremiumUser,
} from "../../../src/lib/premium-types";
import { normalizeApiUrl } from "../api-config";

export class PremiumApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "PremiumApiError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthResponse {
  user: PremiumUser;
  token: string;
  expiresAt: string;
}

export interface BillingStatusResponse {
  entitlement: EntitlementView;
  subscription: PremiumSubscriptionView | null;
  billingConfigured: boolean;
}

export interface PushChange {
  entityType: string;
  entityId: string;
  deleted: boolean;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface PushResponse {
  revision: number;
  accepted: number;
  ignored: number;
  rejected: number;
  conflicts: Array<{
    entityType: string;
    entityId: string;
    winningUpdatedAt: string;
  }>;
}

export interface PullResponse {
  workspaceRevision: number;
  nextRevision: number;
  hasMore: boolean;
  changes: Array<
    PushChange & {
      revision: number;
    }
  >;
}

export interface ConflictResponse {
  conflicts: Array<{
    entityType: string;
    entityId: string;
    incomingUpdatedAt: string;
    winningUpdatedAt: string;
    createdAt: string;
  }>;
}

interface ErrorBody {
  error?: string;
  code?: string;
}

export class PremiumApiClient {
  private readonly apiUrl: string;
  private token: string | null;

  constructor(apiUrl: string, token: string | null = null) {
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  get baseUrl(): string {
    return this.apiUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      token?: string | null;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const token = options.token === undefined ? this.token : options.token;
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "The sync server took too long to respond."
          : "Could not reach the sync server. Check your connection and API address.";
      throw new PremiumApiError(message, 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const body = payload as ErrorBody | null;
      throw new PremiumApiError(
        body?.error ?? `The sync server returned ${response.status}.`,
        response.status,
        body?.code ?? null,
      );
    }

    return payload as T;
  }

  login(email: string, password: string): Promise<AuthResponse> {
    return this.request("POST", "/v1/auth/login", {
      body: { email, password },
      token: null,
    });
  }

  register(name: string, email: string, password: string): Promise<AuthResponse> {
    return this.request("POST", "/v1/auth/register", {
      body: { name, email, password },
      token: null,
    });
  }

  logout(): Promise<void> {
    return this.request("POST", "/v1/auth/logout", { token: this.token });
  }

  me(): Promise<{ user: PremiumUser }> {
    return this.request("GET", "/v1/auth/me");
  }

  entitlement(): Promise<BillingStatusResponse> {
    return this.request("GET", "/v1/entitlement");
  }

  refreshBilling(): Promise<BillingStatusResponse> {
    return this.request("POST", "/v1/billing/refresh");
  }

  startCheckout(): Promise<{ url: string }> {
    return this.request("POST", "/v1/billing/checkout");
  }

  openPortal(): Promise<{ url: string }> {
    return this.request("POST", "/v1/billing/portal");
  }

  pullChanges(since: number, limit = 500): Promise<PullResponse> {
    return this.request(
      "GET",
      `/v1/sync/changes?since=${Math.max(0, Math.trunc(since))}&limit=${limit}`,
    );
  }

  pushChanges(
    changes: PushChange[],
    idempotencyKey: string,
    deviceId: string,
  ): Promise<PushResponse> {
    return this.request("POST", "/v1/sync/changes", {
      body: { changes },
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-Device-Id": deviceId,
      },
      timeoutMs: 30_000,
    });
  }

  conflicts(limit = 20): Promise<ConflictResponse> {
    return this.request("GET", `/v1/sync/conflicts?limit=${limit}`);
  }
}
