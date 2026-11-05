import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  shell,
} from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { DELETE_ACCOUNT_PHRASE } from "../../src/lib/premium-types";
import type {
  AccountDeletionResult,
  PremiumCredentials,
  PremiumRegistration,
  PremiumStatus,
  SyncStatus,
} from "../../src/lib/premium-types";
import type { DesktopState, ThemePreference } from "../../src/lib/desktop-bridge";
import { buildMenu } from "./menu";
import { registerLifecycle } from "./lifecycle";
import {
  databaseUrl,
  logFile,
  rendererDir,
  syncDatabaseUrl,
  syncDirectory,
} from "./paths";
import { PremiumApiClient, PremiumApiError } from "./premium/client";
import { removeSyncMirrorFiles } from "./premium/local-data";
import { SyncEngine } from "./premium/sync-engine";
import {
  clearPremiumSession,
  loadPremiumSession,
  savePremiumSession,
  type StoredPremiumSession,
} from "./premium/token-store";
import { readThemePreference, resolveApiUrl, writeThemePreference } from "./settings";
import { getFreePort } from "./server/free-port";
import { waitForHealth } from "./server/health";
import {
  runMigrations,
  startServer,
  type ServerHandle,
} from "./server/start";

const MAX_PORT_ATTEMPTS = 3;
const HEALTH_TIMEOUT_MS = 60_000;
const APP_USER_MODEL_ID = "com.masar.app";

let server: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let origin = "";
let startUrl = "";
let localApiOrigin = "";
let activeApiUrl = "";
let session: StoredPremiumSession | null = null;
let premiumClient: PremiumApiClient | null = null;
let shuttingDown = false;
/** Remote user id of the workspace the local API is currently serving. */
let activeSyncUserId: string | null = null;
/** Prevents the sync interval from starting a new cycle during deletion. */
let deletingPremiumAccount = false;

function log(line: string): void {
  console.log(line);
  try {
    const file = logFile();
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never crash the app */
  }
}

function fatal(title: string, detail: string): never {
  log(`[fatal] ${title}: ${detail}`);
  dialog.showErrorBox(title, detail);
  app.exit(1);
  throw new Error(detail);
}

const syncEngine = new SyncEngine({
  getClient: () => (deletingPremiumAccount ? null : premiumClient),
  getLocalOrigin: () => localApiOrigin || origin,
  isOnline: () => net.isOnline(),
  log,
  onStatus: (status) => broadcastSyncStatus(status),
  onUnauthorized: (client) => {
    // Ignore 401s from a sync cycle that belonged to a previous session; only
    // expire the session when the rejected client is still the active one.
    if (!session || !premiumClient || premiumClient !== client) return;
    void handleSessionExpired();
  },
});

/**
 * The API revoked or rejected the premium token (for example on logout from
 * another device). Drop the session and move back to the local workspace.
 */
function handleSessionExpired(): void {
  if (!session) return;
  const expired = session;
  session = null;
  premiumClient = null;
  clearPremiumSession();
  syncEngine.disconnect();
  log(`[premium] session expired for ${expired.user.email}`);
  void (async () => {
    try {
      await switchWorkspace(null);
    } catch (error) {
      log(`[premium] could not restore the local workspace: ${String(error)}`);
    }
    refreshMenu();
  })();
}

function broadcastSyncStatus(status: SyncStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("masar:sync-status", status);
  }
}

function disconnectedStatus(error: string | null = null): PremiumStatus {
  return {
    connected: false,
    user: null,
    entitlement: null,
    subscription: null,
    billingConfigured: false,
    error,
  };
}

async function getPremiumStatus(): Promise<PremiumStatus> {
  const currentSession = session;
  const client = premiumClient;
  if (!currentSession || !client) return disconnectedStatus();
  try {
    const billing = await client.entitlement();
    return {
      connected: true,
      user: currentSession.user,
      entitlement: billing.entitlement,
      subscription: billing.subscription,
      billingConfigured: billing.billingConfigured,
      error: null,
    };
  } catch (error) {
    if (error instanceof PremiumApiError && error.status === 401) {
      // Only expire the session if the rejected client is still the current
      // one; a sign-in may have completed while this request was in flight.
      if (premiumClient === client) {
        handleSessionExpired();
        return disconnectedStatus("Your premium session expired. Sign in again.");
      }
      return disconnectedStatus();
    }
    return {
      connected: true,
      user: currentSession.user,
      entitlement: null,
      subscription: null,
      billingConfigured: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not reach the premium sync server.",
    };
  }
}

function getSyncStatus(): SyncStatus {
  if (!session) {
    return {
      phase: "disconnected",
      lastSyncedAt: null,
      pendingChanges: 0,
      lastError: null,
      lastConflictCount: 0,
      skippedChanges: 0,
    };
  }
  return syncEngine.getStatus();
}

function createWindow(): void {
  if (mainWindow || !origin) return;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: "default",
    title: "Masar",
    backgroundColor: "#0b0b0c",
    icon: devWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    broadcastSyncStatus(getSyncStatus());
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      const current = new URL(origin);
      if (target.origin !== current.origin) {
        event.preventDefault();
        if (/^https?:/i.test(url)) void shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      if (!/^https?:/i.test(validatedURL)) return;
      log(`[window] load failed (${errorCode}) ${validatedURL}: ${errorDescription}`);
      showLoadError(errorDescription);
    },
  );
  void mainWindow.loadURL(startUrl || origin).catch(() => {
    /* did-fail-load renders the retry page */
  });
}

function devWindowIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(app.getAppPath(), "desktop", "build", "icon.png");
  return existsSync(icon) ? icon : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showLoadError(description: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = escapeHtml(startUrl || origin);
  const detail = escapeHtml(description);
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Masar could not start</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f6f1;color:#20241f;font-family:ui-sans-serif,system-ui,sans-serif;padding:24px}main{max-width:440px;text-align:center}h1{font-size:24px;margin:0 0 10px}p{font-size:14px;line-height:1.6;opacity:.7}button{margin-top:20px;height:36px;padding:0 16px;border:0;border-radius:8px;background:#2f5d46;color:white;font-size:13px;font-weight:600;cursor:pointer}</style>
    </head><body><main><h1>Masar could not open its local workspace</h1>
    <p>${detail}</p><p>The local database and your work are safe.</p>
    <button onclick="location.href='${target}'">Try again</button></main></body></html>`;
  void mainWindow
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
    .then(() => mainWindow?.show())
    .catch((error) => log(`[window] could not show retry page: ${String(error)}`));
}

function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Environment for the local API process. When `syncUser` is present the
 * process serves that premium account's sync mirror database and advertises it
 * through `MASAR_SYNC_SCOPE`; the sync routes refuse to mutate any database
 * without a matching scope, which keeps local workspace data out of reach of
 * sync requests for good.
 */
function serverEnvFor(
  targetDatabaseUrl: string,
  syncUser: StoredPremiumSession["user"] | null,
): Record<string, string> {
  return {
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: targetDatabaseUrl,
    MASAR_STATIC_DIR: rendererDir(),
    NODE_ENV: "production",
    ...(syncUser
      ? {
          MASAR_SYNC_SCOPE: syncUser.id,
          MASAR_SYNC_USER_NAME: syncUser.name,
          MASAR_SYNC_USER_EMAIL: syncUser.email,
          // The import action reads the local workspace file; never the other
          // way around.
          MASAR_LOCAL_DB_URL: databaseUrl(),
        }
      : {}),
  };
}

async function launchServer(
  targetDatabaseUrl: string,
  syncUser: StoredPremiumSession["user"] | null,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = await getFreePort("127.0.0.1");
    const env = {
      ...serverEnvFor(targetDatabaseUrl, syncUser),
      PORT: String(port),
    };
    const handle = startServer(env, log);
    const candidateOrigin = serverOrigin(port);
    try {
      await Promise.race([
        waitForHealth(`${candidateOrigin}/api/health`, { timeoutMs: HEALTH_TIMEOUT_MS }),
        handle.exited.then((code) => {
          throw new Error(`server exited early with code ${code}`);
        }),
      ]);
      server = handle;
      origin = candidateOrigin;
      localApiOrigin = candidateOrigin;
      return;
    } catch (error) {
      handle.kill();
      const message = error instanceof Error ? error.message : String(error);
      log(`[local] attempt ${attempt} failed: ${message}`);
      if (!message.includes("EADDRINUSE") || attempt === MAX_PORT_ATTEMPTS) throw error;
    }
  }
}

function watchServerExit(handle: ServerHandle): void {
  void handle.exited.then((exitCode) => {
    // Ignore the exit of a server that was deliberately replaced by a
    // workspace switch or an intentional shutdown.
    if (shuttingDown || server !== handle) return;
    fatal(
      "Masar local workspace stopped",
      `The local API exited unexpectedly (code ${exitCode}).`,
    );
  });
}

/**
 * Point the local API at a different workspace database and reload the
 * renderer so it re-reads its data from that workspace.
 *
 *   - signed out: the local workspace (`masar.db`).
 *   - signed in:  the premium account's own sync mirror (`sync/<user>.db`).
 *
 * The previous server process is stopped first so no request can land on the
 * old database after the switch. A sync cycle that is still in flight either
 * completes against the old process or fails cleanly; the scope guard in the
 * sync routes makes it impossible for it to write into the wrong database.
 *
 * Switches are serialised: a session expiry and a new sign-in can race, and
 * only the last requested workspace may win.
 */
let switchQueue: Promise<void> = Promise.resolve();

function switchWorkspace(
  syncUser: StoredPremiumSession["user"] | null,
  reloadPath = "/",
): Promise<void> {
  const next = switchQueue.then(() =>
    performWorkspaceSwitch(syncUser, reloadPath),
  );
  switchQueue = next.catch(() => undefined);
  return next;
}

function rendererUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, origin).toString();
}

async function performWorkspaceSwitch(
  syncUser: StoredPremiumSession["user"] | null,
  reloadPath: string,
): Promise<void> {
  if (isDevMode()) {
    // The development launcher owns the local API and cannot switch
    // databases. Premium sync is unavailable against the shared dev API; see
    // desktop/scripts/dev.ts.
    return;
  }

  const nextUserId = syncUser?.id ?? null;
  if (server && activeSyncUserId === nextUserId) {
    // Already serving the requested workspace (for example a duplicate
    // logout). Avoid an unnecessary restart and reload. An explicit post-switch
    // path still needs to be honoured (account deletion navigates to a notice).
    if (reloadPath !== "/" && mainWindow && !mainWindow.isDestroyed()) {
      startUrl = rendererUrl(reloadPath);
      void mainWindow.loadURL(startUrl).catch(() => {
        /* did-fail-load renders the retry page */
      });
    }
    return;
  }

  const targetDatabaseUrl = syncUser
    ? syncDatabaseUrl(syncUser.id)
    : databaseUrl();

  const previous = server;
  server = null;
  activeSyncUserId = null;
  previous?.kill();
  if (previous) await previous.exited.catch(() => 0);

  if (syncUser) {
    // Keep the local workspace file migrated as well, so the explicit import
    // action can always read it (for example a fresh install that signs in
    // without ever opening the local workspace). Failure is not fatal: sync
    // itself never reads the local database.
    const localMigration = await runMigrations(log, databaseUrl());
    if (localMigration.code !== 0) {
      log(`[local] local workspace migration failed: ${localMigration.stderr.trim()}`);
    }
  }

  const { code, stderr } = await runMigrations(log, targetDatabaseUrl);
  if (code !== 0) {
    fatal("Database migration failed", stderr.trim() || `exit code ${code}`);
  }

  await launchServer(targetDatabaseUrl, syncUser);
  activeSyncUserId = nextUserId;
  watchServerExit(server!);
  startUrl = rendererUrl(reloadPath);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // `origin` now points at the new server process; reload() would re-request
    // the old (dead) origin instead.
    void mainWindow.loadURL(startUrl).catch(() => {
      /* did-fail-load renders the retry page */
    });
  }
}

function isDevMode(): boolean {
  return Boolean(process.env.MASAR_DEV_SERVER_URL?.trim());
}

async function bootstrap(): Promise<void> {
  // safeStorage and userData paths are reliable once Electron is ready. Load
  // the premium session here rather than at module import time.
  activeApiUrl = resolveApiUrl();
  session = loadPremiumSession();
  if (session && session.apiUrl !== activeApiUrl) {
    // A token belongs to the server that issued it. Changing API addresses
    // always requires a fresh sign-in.
    clearPremiumSession();
    session = null;
  }
  premiumClient = session
    ? new PremiumApiClient(session.apiUrl, session.token)
    : null;

  if (isDevMode()) {
    origin = process.env.MASAR_DEV_SERVER_URL!.trim();
    startUrl = origin;
    localApiOrigin = process.env.MASAR_DEV_API_URL?.trim() || "http://127.0.0.1:4782";
    log(`[dev] renderer ${origin}, local API ${localApiOrigin}`);
    createWindow();
    syncEngine.start();
    if (session) void syncEngine.syncNow("startup");
    return;
  }

  // A stored premium session means the app opens that account's sync mirror;
  // otherwise the local workspace.
  const syncUser = session?.user ?? null;
  const targetDatabaseUrl = syncUser
    ? syncDatabaseUrl(syncUser.id)
    : databaseUrl();

  const { code, stderr } = await runMigrations(log, targetDatabaseUrl);
  if (code !== 0) {
    fatal("Database migration failed", stderr.trim() || `exit code ${code}`);
  }

  try {
    await launchServer(targetDatabaseUrl, syncUser);
  } catch (error) {
    fatal("Masar local workspace failed to start", String(error));
  }
  activeSyncUserId = syncUser?.id ?? null;

  startUrl = origin;
  createWindow();
  watchServerExit(server!);
  syncEngine.start();
  if (session) void syncEngine.syncNow("startup");
}

function showAccount(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("masar:navigate", "/account");
}

function requireClient(): PremiumApiClient {
  if (!premiumClient) {
    throw new Error("Sign in to premium sync first.");
  }
  return premiumClient;
}

function expireSession(): void {
  clearPremiumSession();
  session = null;
  premiumClient = null;
  syncEngine.disconnect();
}

/**
 * Adopt a freshly issued premium session and switch the local API to that
 * account's sync mirror. The renderer reloads and shows the premium workspace.
 * No local workspace data is touched: the mirror starts empty (or resumes the
 * account's previous mirror) and is filled from the API by the sync engine.
 */
async function adoptSession(
  auth: { token: string; user: StoredPremiumSession["user"] },
): Promise<void> {
  if (!activeApiUrl) throw new Error("No API address is configured.");
  const next: StoredPremiumSession = {
    apiUrl: activeApiUrl,
    token: auth.token,
    user: auth.user,
  };
  savePremiumSession(next);
  session = next;
  premiumClient = new PremiumApiClient(activeApiUrl, auth.token);
  syncEngine.disconnect();
  try {
    await switchWorkspace(next.user);
  } catch (error) {
    // Do not leave a stored session whose workspace could not be opened.
    clearPremiumSession();
    session = null;
    premiumClient = null;
    throw error;
  }
  refreshMenu();
}

/**
 * Sign out: revoke the API session, drop the token, drain any in-flight sync
 * cycle and switch the local API back to the local workspace. The account's
 * mirror file stays on disk so signing in again resumes where it left off.
 */
async function disconnectSession(): Promise<void> {
  if (premiumClient) {
    try {
      await premiumClient.logout();
    } catch (error) {
      log(`[premium] logout request failed: ${String(error)}`);
    }
  }
  expireSession();
  await syncEngine.idle();
  await switchWorkspace(null);
  refreshMenu();
}

/**
 * Permanently delete the connected premium account.
 *
 * Ordering matters:
 * 1. Stop new sync cycles and let the current one drain.
 * 2. Delete the remote account, which cascades sessions and all cloud data.
 * 3. Clear the local token and switch the local API back to `masar.db`.
 * 4. Delete the per-account mirror and its SQLite sidecar files.
 *
 * The separate offline local workspace is deliberately untouched. If a local
 * cleanup step fails after the remote deletion succeeded, the account is still
 * gone; the caller receives a warning instead of a misleading failure.
 */
async function deletePremiumAccount(
  confirmation: string,
): Promise<AccountDeletionResult> {
  if (confirmation !== DELETE_ACCOUNT_PHRASE) {
    throw new Error(`Type "${DELETE_ACCOUNT_PHRASE}" exactly to confirm.`);
  }
  const currentSession = session;
  const client = premiumClient;
  if (!currentSession || !client) {
    throw new Error("Sign in before deleting your account.");
  }
  if (deletingPremiumAccount) {
    throw new Error("Account deletion is already in progress.");
  }

  deletingPremiumAccount = true;
  try {
    await syncEngine.idle();
    await client.deleteAccount(confirmation);
  } catch (error) {
    deletingPremiumAccount = false;
    throw error;
  }

  expireSession();

  let cleanupWarning: string | null = null;
  try {
    // The renderer is reloaded when the local API switches databases. Use a
    // query flag so the success notice survives that reload.
    await switchWorkspace(null, "/account?deleted=1");
  } catch (error) {
    cleanupWarning =
      "Your account was deleted, but Masar could not reopen the local workspace. Restart the app before continuing.";
    log(`[premium] could not switch to the local workspace after deletion: ${String(error)}`);
  }

  try {
    const removed = removeSyncMirrorFiles(syncDirectory(), currentSession.user.id);
    log(`[premium] removed ${removed.length} mirror file(s) for ${currentSession.user.id}`);
  } catch (error) {
    if (!cleanupWarning) {
      cleanupWarning =
        "Your account was deleted, but the local synced copy could not be removed. Restart the app and try again.";
    }
    log(`[premium] could not remove the sync mirror: ${String(error)}`);
  }

  deletingPremiumAccount = false;
  refreshMenu();
  if (cleanupWarning && mainWindow && !mainWindow.isDestroyed()) {
    void dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: "Account deleted",
        message: cleanupWarning,
        buttons: ["OK"],
      })
      .catch((error) => {
        log(`[premium] could not show the deletion cleanup warning: ${String(error)}`);
      });
  }
  return { status: await getPremiumStatus(), cleanupWarning };
}

/** Read the local workspace and copy it into the connected premium workspace. */
async function importLocalWorkspace(): Promise<{ boards: number; tasks: number }> {
  if (!session) throw new Error("Sign in to premium sync first.");
  const apiOrigin = localApiOrigin;
  if (!apiOrigin) throw new Error("The local workspace is not available.");
  const response = await fetch(`${apiOrigin}/api/sync/import-local`, {
    method: "POST",
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
        : `Could not import the local workspace (${response.status}).`;
    throw new Error(message);
  }
  return payload as { boards: number; tasks: number };
}

function requireDeletionConfirmation(value: unknown): string {
  if (typeof value !== "string" || value !== DELETE_ACCOUNT_PHRASE) {
    throw new Error(`Type "${DELETE_ACCOUNT_PHRASE}" exactly to confirm.`);
  }
  return value;
}

function requireString(
  value: unknown,
  field: string,
  max = 200,
): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  if (trimmed.length > max) throw new Error(`${field} is too long.`);
  return trimmed;
}

function parseCredentials(input: unknown): PremiumCredentials {
  if (!input || typeof input !== "object") throw new Error("Invalid credentials.");
  const record = input as Record<string, unknown>;
  const email = requireString(record.email, "Email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const password = requireString(record.password, "Password", 128);
  return { email, password };
}

function parseRegistration(input: unknown): PremiumRegistration {
  const credentials = parseCredentials(input);
  const record = input as Record<string, unknown>;
  return {
    ...credentials,
    name: requireString(record.name, "Name", 80),
  };
}

function registerIpc(): void {
  ipcMain.handle("masar:get-state", (): DesktopState => ({
    isDesktop: true,
    mode: "local",
    version: app.getVersion(),
  }));

  ipcMain.on("masar:get-theme", (event) => {
    event.returnValue = readThemePreference();
  });

  ipcMain.handle("masar:set-theme", (_event, value: unknown) => {
    if (value !== "light" && value !== "dark" && value !== "system") {
      throw new Error("Invalid theme preference.");
    }
    const theme: ThemePreference = value;
    writeThemePreference(theme);
    nativeTheme.themeSource = theme;
    return theme;
  });

  ipcMain.handle("masar:get-premium-status", () => getPremiumStatus());
  ipcMain.handle("masar:get-sync-status", () => getSyncStatus());

  ipcMain.handle("masar:premium-login", async (_event, input: unknown) => {
    const credentials = parseCredentials(input);
    const client = new PremiumApiClient(activeApiUrl, null);
    const auth = await client.login(credentials.email, credentials.password);
    await adoptSession(auth);
    void syncEngine.syncNow("login");
    return getPremiumStatus();
  });

  ipcMain.handle("masar:premium-register", async (_event, input: unknown) => {
    const registration = parseRegistration(input);
    const client = new PremiumApiClient(activeApiUrl, null);
    const auth = await client.register(
      registration.name,
      registration.email,
      registration.password,
    );
    await adoptSession(auth);
    void syncEngine.syncNow("register");
    return getPremiumStatus();
  });

  ipcMain.handle("masar:premium-logout", async () => {
    await disconnectSession();
    return getPremiumStatus();
  });

  ipcMain.handle("masar:premium-delete-account", async (_event, input: unknown) => {
    const confirmation = requireDeletionConfirmation(input);
    return deletePremiumAccount(confirmation);
  });

  ipcMain.handle("masar:import-local", async () => {
    const result = await importLocalWorkspace();
    void syncEngine.syncNow("import");
    return result;
  });

  ipcMain.handle("masar:start-checkout", async () => {
    const result = await requireClient().startCheckout();
    const url = new URL(result.url);
    if (url.protocol !== "https:") throw new Error("Billing returned an insecure URL.");
    await shell.openExternal(url.toString());
    return result;
  });

  ipcMain.handle("masar:open-portal", async () => {
    const result = await requireClient().openPortal();
    const url = new URL(result.url);
    if (url.protocol !== "https:") throw new Error("Billing returned an insecure URL.");
    await shell.openExternal(url.toString());
    return result;
  });

  ipcMain.handle("masar:refresh-billing", async () => {
    const client = requireClient();
    const billing = await client.refreshBilling();
    if (billing.entitlement.entitled) void syncEngine.syncNow("billing-refresh");
    return getPremiumStatus();
  });

  ipcMain.handle("masar:sync-now", async () => {
    if (!session) return getSyncStatus();
    return syncEngine.syncNow("manual");
  });

  ipcMain.handle("masar:notify-data-change", () => {
    syncEngine.notifyDataChanged();
  });
}

function refreshMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      onOpenAccount: showAccount,
      onSyncNow: () => void syncEngine.syncNow("menu"),
      canImportLocal: Boolean(session),
      workspaceLabel: session
        ? `Premium workspace — ${session.user.email}`
        : "Masar Local Workspace",
      onImportLocal: () => {
        void importLocalWorkspace()
          .then((result) => {
            void syncEngine.syncNow("import");
            if (mainWindow && !mainWindow.isDestroyed()) {
              dialog.showMessageBox(mainWindow, {
                type: "info",
                title: "Import complete",
                message:
                  result.boards === 0
                    ? "There is no local workspace to import."
                    : `Imported ${result.boards} board(s) and ${result.tasks} task(s) into your premium workspace.`,
              });
            }
          })
          .catch((error) => {
            log(`[premium] import failed: ${String(error)}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              dialog.showErrorBox(
                "Import failed",
                error instanceof Error ? error.message : String(error),
              );
            }
          });
      },
    }),
  );
}

app.on("before-quit", () => {
  shuttingDown = true;
  syncEngine.stop();
});

registerLifecycle({
  getServer: () => server,
  createWindow,
  hasWindow: () => mainWindow !== null,
});

void app.whenReady().then(async () => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  log("[boot] app ready");
  try {
    nativeTheme.themeSource = readThemePreference();
    registerIpc();
    refreshMenu();
    await bootstrap();
  } catch (error) {
    fatal("Masar failed to start", error instanceof Error ? error.message : String(error));
  }
});

process.on("uncaughtException", (error) =>
  log(`[process] uncaughtException: ${error.stack ?? error.message}`),
);
process.on("unhandledRejection", (reason) =>
  log(`[process] unhandledRejection: ${String(reason)}`),
);
