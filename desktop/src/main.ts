import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  shell,
} from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type {
  PremiumCredentials,
  PremiumRegistration,
  PremiumStatus,
  SyncStatus,
} from "../../src/lib/premium-types";
import type { DesktopState } from "../../src/lib/desktop-bridge";
import { buildMenu } from "./menu";
import { registerLifecycle } from "./lifecycle";
import { databaseUrl, logFile, rendererDir } from "./paths";
import { PremiumApiClient, PremiumApiError } from "./premium/client";
import { SyncEngine } from "./premium/sync-engine";
import {
  clearPremiumSession,
  loadPremiumSession,
  savePremiumSession,
  type StoredPremiumSession,
} from "./premium/token-store";
import { saveApiUrl, resolveApiUrl } from "./settings";
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
let activeApiUrl = resolveApiUrl();
let session: StoredPremiumSession | null = loadPremiumSession();
let premiumClient: PremiumApiClient | null = null;
let shuttingDown = false;

if (session && session.apiUrl !== activeApiUrl) {
  // A token belongs to the server that issued it. Changing API addresses
  // always requires a fresh sign-in.
  clearPremiumSession();
  session = null;
}
if (session) premiumClient = new PremiumApiClient(session.apiUrl, session.token);

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
  getClient: () => premiumClient,
  getLocalOrigin: () => localApiOrigin || origin,
  isOnline: () => net.isOnline(),
  log,
  onStatus: (status) => broadcastSyncStatus(status),
  onUnauthorized: () => {
    clearPremiumSession();
    session = null;
    premiumClient = null;
    log("[premium] session expired");
  },
});

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
    apiUrl: activeApiUrl,
    error,
  };
}

async function getPremiumStatus(): Promise<PremiumStatus> {
  if (!session || !premiumClient) return disconnectedStatus();
  try {
    const billing = await premiumClient.entitlement();
    return {
      connected: true,
      user: session.user,
      entitlement: billing.entitlement,
      subscription: billing.subscription,
      billingConfigured: billing.billingConfigured,
      apiUrl: activeApiUrl,
      error: null,
    };
  } catch (error) {
    if (error instanceof PremiumApiError && error.status === 401) {
      clearPremiumSession();
      session = null;
      premiumClient = null;
      syncEngine.disconnect();
      return disconnectedStatus("Your premium session expired. Sign in again.");
    }
    return {
      connected: true,
      user: session.user,
      entitlement: null,
      subscription: null,
      billingConfigured: false,
      apiUrl: activeApiUrl,
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

async function launchServer(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = await getFreePort("127.0.0.1");
    const handle = startServer(
      {
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        DATABASE_URL: databaseUrl(),
        MASAR_STATIC_DIR: rendererDir(),
        NODE_ENV: "production",
      },
      log,
    );
    const candidateOrigin = serverOrigin(port);
    try {
      await Promise.race([
        waitForHealth(`${candidateOrigin}/api/health`, { timeoutMs: HEALTH_TIMEOUT_MS }),
        handle.exited.then((code) => {
          throw new Error(`local server exited early with code ${code}`);
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

function watchServerExit(): void {
  void server?.exited.then((exitCode) => {
    if (shuttingDown) return;
    fatal(
      "Masar local workspace stopped",
      `The local API exited unexpectedly (code ${exitCode}).`,
    );
  });
}

async function bootstrap(): Promise<void> {
  const devUrl = process.env.MASAR_DEV_SERVER_URL?.trim();
  if (devUrl) {
    origin = devUrl;
    startUrl = devUrl;
    localApiOrigin = process.env.MASAR_DEV_API_URL?.trim() || "http://127.0.0.1:4782";
    log(`[dev] renderer ${origin}, local API ${localApiOrigin}`);
    createWindow();
    syncEngine.start();
    if (session) void syncEngine.syncNow("startup");
    return;
  }

  const { code, stderr } = await runMigrations(log);
  if (code !== 0) {
    fatal("Database migration failed", stderr.trim() || `exit code ${code}`);
  }

  try {
    await launchServer();
  } catch (error) {
    fatal("Masar local workspace failed to start", String(error));
  }

  startUrl = origin;
  createWindow();
  watchServerExit();
  syncEngine.start();
  if (session) void syncEngine.syncNow("startup");
}

function showSyncSettings(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("masar:navigate", "/settings/sync");
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

function adoptSession(auth: { token: string; user: StoredPremiumSession["user"] }): void {
  if (!activeApiUrl) throw new Error("No API address is configured.");
  session = { apiUrl: activeApiUrl, token: auth.token, user: auth.user };
  savePremiumSession(session);
  premiumClient = new PremiumApiClient(activeApiUrl, auth.token);
  syncEngine.disconnect();
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
    apiUrl: activeApiUrl,
    version: app.getVersion(),
  }));

  ipcMain.handle("masar:get-premium-status", () => getPremiumStatus());
  ipcMain.handle("masar:get-sync-status", () => getSyncStatus());

  ipcMain.handle("masar:premium-login", async (_event, input: unknown) => {
    const credentials = parseCredentials(input);
    const client = new PremiumApiClient(activeApiUrl, null);
    const auth = await client.login(credentials.email, credentials.password);
    adoptSession(auth);
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
    adoptSession(auth);
    void syncEngine.syncNow("register");
    return getPremiumStatus();
  });

  ipcMain.handle("masar:premium-logout", async () => {
    if (premiumClient) {
      try {
        await premiumClient.logout();
      } catch (error) {
        log(`[premium] logout request failed: ${String(error)}`);
      }
    }
    expireSession();
    return getPremiumStatus();
  });

  ipcMain.handle("masar:set-api-url", async (_event, value: unknown) => {
    const next = saveApiUrl(requireString(value, "API address", 500));
    if (next !== activeApiUrl) {
      expireSession();
      activeApiUrl = next;
    }
    return getPremiumStatus();
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

  ipcMain.handle("masar:open-sync-settings", () => {
    showSyncSettings();
  });
}

function refreshMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      onOpenSync: showSyncSettings,
      onSyncNow: () => void syncEngine.syncNow("menu"),
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
