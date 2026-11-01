import type { SyncStatus } from "../../../src/lib/premium-types";
import type { LocalSyncChange, SyncStateView } from "../../../src/sync/local";
import {
  PremiumApiError,
  type PremiumApiClient,
  type PushChange,
} from "./client";

interface LocalApplyResponse {
  applied: number;
  skipped: Array<{ entityType: string; entityId: string; reason: string }>;
  lastRevision: number;
}

interface SyncEngineOptions {
  getClient(): PremiumApiClient | null;
  getLocalOrigin(): string;
  isOnline(): boolean;
  log(line: string): void;
  onStatus(status: SyncStatus): void;
  /** Called with the client whose request was rejected with 401. */
  onUnauthorized(client: PremiumApiClient): void;
}

const INITIAL_STATUS: SyncStatus = {
  phase: "disconnected",
  lastSyncedAt: null,
  pendingChanges: 0,
  lastError: null,
  lastConflictCount: 0,
  skippedChanges: 0,
};

export class SyncEngine {
  private status: SyncStatus = { ...INITIAL_STATUS };
  private inFlight: Promise<SyncStatus> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;

  constructor(private readonly options: SyncEngineOptions) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      if (this.options.getClient()) void this.syncNow("interval");
    }, 60_000);
    this.interval.unref?.();
    if (this.options.getClient()) {
      setTimeout(() => void this.syncNow("startup"), 1_500).unref?.();
    }
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
    this.interval = null;
    this.debounce = null;
  }

  disconnect(): void {
    this.update({ ...INITIAL_STATUS });
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  notifyDataChanged(): void {
    if (!this.options.getClient()) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.syncNow("local-change");
    }, 1_500);
    this.debounce.unref?.();
  }

  syncNow(reason = "manual"): Promise<SyncStatus> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(reason).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Resolves once any in-flight sync cycle has finished (or immediately). */
  idle(): Promise<void> {
    if (!this.inFlight) return Promise.resolve();
    return this.inFlight.then(() => undefined);
  }

  private update(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.options.onStatus(this.status);
  }

  private async run(reason: string): Promise<SyncStatus> {
    const client = this.options.getClient();
    if (!client) {
      this.update({ ...INITIAL_STATUS });
      return this.status;
    }
    if (!this.options.isOnline()) {
      this.update({
        phase: "error",
        lastError: "You are offline. Local changes are saved and will sync later.",
      });
      return this.status;
    }

    this.options.log(`[sync] starting (${reason})`);
    this.update({ phase: "syncing", lastError: null, skippedChanges: 0 });

    try {
      const me = await client.me();
      const billing = await client.entitlement();
      const localState = await this.prepare(me.user.id);

      if (!billing.entitlement.entitled) {
        this.update({
          phase: "subscription_required",
          pendingChanges: localState.pendingChanges,
          lastError: null,
        });
        return this.status;
      }

      const firstPush = await this.pushAll(client, localState.deviceId);
      const pull = await this.pullAll(client, me.user.id, localState.lastRevision);
      const secondPush = pull.skipped > 0
        ? await this.pushAll(client, localState.deviceId)
        : { conflicts: 0, pushed: 0 };
      const state = await this.localRequest<{ state: SyncStateView }>(
        "GET",
        "/api/sync/state",
      );

      this.update({
        phase: "idle",
        pendingChanges: state.state.pendingChanges,
        lastSyncedAt: state.state.lastSyncedAt ?? new Date().toISOString(),
        lastConflictCount: firstPush.conflicts + secondPush.conflicts,
        skippedChanges: pull.skipped,
        lastError: null,
      });
      this.options.log(
        `[sync] completed: pushed=${firstPush.pushed + secondPush.pushed} pulled=${pull.applied} conflicts=${firstPush.conflicts + secondPush.conflicts} skipped=${pull.skipped}`,
      );
      return this.status;
    } catch (error) {
      if (error instanceof PremiumApiError) {
        if (error.status === 401) {
          this.options.onUnauthorized(client);
          this.update({
            ...INITIAL_STATUS,
            phase: "error",
            lastError: "Your premium session expired. Sign in again.",
          });
          return this.status;
        }
        if (error.status === 402) {
          const pending = await this.safePendingCount();
          this.update({
            phase: "subscription_required",
            pendingChanges: pending,
            lastError: null,
          });
          return this.status;
        }
        this.update({ phase: "error", lastError: error.message });
        this.options.log(`[sync] failed: ${error.message}`);
        return this.status;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.update({ phase: "error", lastError: message });
      this.options.log(`[sync] failed: ${message}`);
      return this.status;
    }
  }

  private async prepare(remoteUserId: string): Promise<SyncStateView> {
    const response = await this.localRequest<{ state: SyncStateView }>(
      "POST",
      "/api/sync/prepare",
      { remoteUserId },
    );
    return response.state;
  }

  private async pushAll(
    client: PremiumApiClient,
    deviceId: string,
  ): Promise<{ pushed: number; conflicts: number }> {
    let pushed = 0;
    let conflicts = 0;
    let lastId = 0;

    for (let batch = 0; batch < 50; batch += 1) {
      const data = await this.localRequest<{ changes: LocalSyncChange[] }>(
        "GET",
        `/api/sync/pending?after=${lastId}&limit=200`,
      );
      if (data.changes.length === 0) break;

      const first = data.changes[0]!;
      const last = data.changes[data.changes.length - 1]!;

      const response = await client.pushChanges(
        data.changes.map<PushChange>((change) => ({
          entityType: change.entityType,
          entityId: change.entityId,
          deleted: change.deleted,
          data: change.data,
          updatedAt: change.updatedAt,
          baseRevision: change.baseRevision,
        })),
        `${deviceId}:${first.id}:${last.id}`,
        deviceId,
      );

      pushed += response.accepted;
      conflicts += response.rejected;
      await this.localRequest("POST", "/api/sync/ack", { throughId: last.id });
      lastId = last.id;
    }

    return { pushed, conflicts };
  }

  private async pullAll(
    client: PremiumApiClient,
    remoteUserId: string,
    initialRevision: number,
  ): Promise<{ applied: number; skipped: number }> {
    let cursor = initialRevision;
    let applied = 0;
    let skipped = 0;

    for (let page = 0; page < 100; page += 1) {
      let response = await client.pullChanges(cursor);
      if (response.workspaceRevision < cursor) {
        this.options.log("[sync] remote revision moved backwards; restarting cursor");
        await this.localRequest("POST", "/api/sync/prepare", {
          remoteUserId,
          resetCursor: true,
        });
        cursor = 0;
        response = await client.pullChanges(0);
      }

      if (response.changes.length > 0) {
        const appliedResult = await this.localRequest<LocalApplyResponse>(
          "POST",
          "/api/sync/apply",
          {
            nextRevision: response.nextRevision,
            changes: response.changes,
          },
        );
        applied += appliedResult.applied;
        skipped += appliedResult.skipped.length;
      } else {
        await this.localRequest("POST", "/api/sync/apply", {
          nextRevision: response.nextRevision,
          changes: [],
        });
      }

      cursor = response.nextRevision;
      if (!response.hasMore) break;
    }

    return { applied, skipped };
  }

  private async localRequest<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const origin = this.options.getLocalOrigin();
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `Local sync request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload as T;
  }

  private async safePendingCount(): Promise<number> {
    try {
      const state = await this.localRequest<{ state: SyncStateView }>(
        "GET",
        "/api/sync/state",
      );
      return state.state.pendingChanges;
    } catch {
      return this.status.pendingChanges;
    }
  }
}
