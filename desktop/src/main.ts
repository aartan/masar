import { app, BrowserWindow, dialog, ipcMain, Menu, net } from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { buildLocalEnv, serverOrigin } from "./env";
import { registerLifecycle } from "./lifecycle";
import { buildMenu } from "./menu";
import { connectionErrorPage } from "./offline-page";
import { getOrCreateAuthSecret } from "./secret";
import { readSettings, resolveSyncUrl, writeSettings, type WorkspaceMode } from "./settings";
import { getFreePort } from "./server/free-port";
import { waitForHealth } from "./server/health";
import {
  exportLocalWorkspace,
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
let activeMode: WorkspaceMode = "local";
let shuttingDown = false;

function log(line: string): void {
  console.log(line);
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "masar.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

function fatal(title: string, detail: string): never {
  log(`[fatal] ${title}: ${detail}`);
  dialog.showErrorBox(title, detail);
  app.exit(1);
  throw new Error(detail);
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
    title: activeMode === "sync" ? "Masar · Sync" : "Masar",
    backgroundColor: "#0b0b0c",
    icon: devWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("page-title-updated", (event, title) => {
    if (activeMode !== "sync") return;
    event.preventDefault();
    mainWindow?.setTitle(title ? `${title} · Sync` : "Masar · Sync");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which happens on ordinary redirects/reloads.
      if (!isMainFrame || errorCode === -3) return;
      if (!/^https?:/i.test(validatedURL)) return;
      log(
        `[window] load failed (${errorCode}) ${validatedURL}: ${errorDescription}`,
      );
      showConnectionError(errorDescription);
    },
  );
  mainWindow.webContents.on("will-navigate", blockVercelAuthNavigation);
  mainWindow.webContents.on("will-redirect", blockVercelAuthNavigation);
  void mainWindow.loadURL(startUrl || origin).catch(() => {
    // `did-fail-load` renders the connection fallback below.
  });
}

/** Development-only window icon; packaged builds use the executable icon. */
function devWindowIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(app.getAppPath(), "desktop", "build", "icon.png");
  return existsSync(icon) ? icon : undefined;
}

/** Render a local fallback instead of leaving an empty Chromium error page. */
function showConnectionError(description: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const page = connectionErrorPage({
    origin: startUrl || origin,
    description,
    canUseLocal: activeMode === "sync",
  });
  void mainWindow
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
    .then(() => mainWindow?.show())
    .catch((error) => {
      log(`[window] could not show connection fallback: ${String(error)}`);
    });
}

/**
 * Vercel deployment protection redirects unauthenticated Electron windows to
 * vercel.com's SSO screen. That page can never sign the desktop app in, so
 * surface an actionable explanation instead of a confusing third-party login.
 */
function blockVercelAuthNavigation(
  event: { preventDefault: () => void },
  url: string,
): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }
  if (hostname !== "vercel.com" && hostname !== "www.vercel.com") return;

  event.preventDefault();
  log(`[window] blocked Vercel authentication redirect: ${url}`);
  showConnectionError(
    "This sync deployment is protected by Vercel Authentication. Use a public production URL, or disable Vercel Deployment Protection, then try again.",
  );
}

/** Start the local-mode server, retrying once per EADDRINUSE with a fresh port. */
async function launchServer(env: Record<string, string>): Promise<void> {
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    const port = await getFreePort("127.0.0.1");
    const handle = startServer(
      { ...env, PORT: String(port), BETTER_AUTH_URL: serverOrigin(port) },
      log,
    );
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
      return;
    } catch (error) {
      handle.kill();
      const message = error instanceof Error ? error.message : String(error);
      log(`[server] attempt ${attempt} failed: ${message}`);
      if (!message.includes("EADDRINUSE") || attempt === MAX_PORT_ATTEMPTS) throw error;
    }
  }
}

function watchServerExit(): void {
  void server?.exited.then((exitCode) => {
    if (shuttingDown) return;
    fatal("Masar server stopped", `The local server exited unexpectedly (code ${exitCode}).`);
  });
}

/** Persist a mode change and relaunch so the app restarts against the new backend. */
function switchMode(mode: WorkspaceMode): void {
  // Mark the shutdown as intentional first: app.exit() does not fire
  // `before-quit`, so without this the local server's exit would be reported
  // as an unexpected crash by watchServerExit.
  shuttingDown = true;
  writeSettings({ mode });
  server?.kill();
  app.relaunch();
  app.exit(0);
}

/**
 * Prefer the desktop onboarding route, but fall back to the hosted login when
 * an older deployment does not have it yet. A HEAD request is cheap and keeps
 * the desktop shell usable against deployments that predate this build.
 */
async function hostedStartUrl(base: string): Promise<string> {
  const root = base.replace(/\/+$/, "");
  const onboarding = `${root}/desktop`;
  try {
    const response = await net.fetch(onboarding, {
      method: "HEAD",
      redirect: "follow",
    });
    if (response.ok) return onboarding;
    log(
      `[mode] ${onboarding} returned ${response.status}; using the hosted login`,
    );
  } catch (error) {
    log(`[mode] could not probe ${onboarding}: ${String(error)}`);
  }
  return `${root}/login`;
}

async function bootstrap(): Promise<void> {
  // Development: attach to a running `next dev` server (desktop/scripts/dev.ts).
  const devUrl = process.env.MASAR_DEV_SERVER_URL?.trim();
  if (devUrl) {
    origin = devUrl;
    startUrl = devUrl;
    createWindow();
    return;
  }

  const settings = readSettings();
  activeMode = settings.mode;
  log(`[mode] ${activeMode}`);

  if (activeMode === "sync") {
    const url = resolveSyncUrl();
    if (url) {
      // Sync mode loads the centrally-hosted app directly: no local server and
      // no database credentials in the app. Start at the desktop onboarding
      // page so a first run explains the separate desktop sign-in instead of
      // dropping the user on the hosted login form. The auth layout sends
      // already signed-in users straight to the workspace.
      log(`[mode] loading hosted workspace: ${url}`);
      origin = url;
      startUrl = await hostedStartUrl(url);
      createWindow();
      return;
    }
    // Misconfigured: fall back to local so the app still works.
    log("[mode] sync selected but no hosted URL configured; reverting to local");
    dialog.showErrorBox(
      "Sync is not available",
      "This installation has no hosted Masar URL configured. Opening your local workspace instead.",
    );
    writeSettings({ mode: "local" });
    activeMode = "local";
  }

  // Local mode: encrypted secret, migrate the local DB, then serve it.
  let secret: string;
  try {
    secret = getOrCreateAuthSecret();
  } catch (error) {
    fatal("Masar cannot start", `Could not initialize secure storage.\n\n${String(error)}`);
  }

  const { code, stderr } = await runMigrations(log);
  if (code !== 0) {
    fatal("Database migration failed", stderr.trim() || `exit code ${code}`);
  }

  try {
    await launchServer(buildLocalEnv(secret));
  } catch (error) {
    fatal("Masar server failed to start", String(error));
  }

  startUrl = origin;
  createWindow();
  watchServerExit();
}

type ImportResult = { boards: number; tasks: number } | { error: string };

function getDesktopState() {
  return {
    isDesktop: true,
    mode: activeMode,
  };
}

/** Enter sync mode (relaunches) if a hosted URL is configured. */
function enableSync(): { ok: boolean; error?: string } {
  if (!resolveSyncUrl()) {
    const error = "Sync is not configured in this build.";
    dialog.showErrorBox("Sync is not available", error);
    return { ok: false, error };
  }
  switchMode("sync"); // relaunches
  return { ok: true };
}

function switchToLocal(): void {
  switchMode("local"); // relaunches
}

/** POST to a desktop API route on the current origin, using its session cookies. */
async function callDesktopApi(route: string, body?: string): Promise<{ ok: boolean; body: string }> {
  const cookies = await mainWindow!.webContents.session.cookies.get({ url: origin });
  const headers: Record<string, string> = {
    Origin: origin,
    Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  if (body) headers["Content-Type"] = "application/json";
  const response = await net.fetch(`${origin}${route}`, { method: "POST", headers, body });
  return { ok: response.ok, body: await response.text() };
}

/** Read the local workspace and upload it into the signed-in hosted account. */
async function importLocalWorkspace(): Promise<ImportResult> {
  if (!mainWindow) return { error: "No window." };
  try {
    const payloadJson = await exportLocalWorkspace(log);
    const payload = JSON.parse(payloadJson) as { boards: unknown[] };
    if (!payload.boards || payload.boards.length === 0) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Nothing to import",
        message: "There is no local workspace to import.",
      });
      return { boards: 0, tasks: 0 };
    }
    const { ok, body } = await callDesktopApi("/api/desktop/import-local", payloadJson);
    if (!ok) {
      const message = (() => {
        try {
          return (JSON.parse(body) as { error?: string }).error ?? body;
        } catch {
          return body;
        }
      })();
      dialog.showErrorBox("Import failed", message || "Could not import the local workspace.");
      return { error: message };
    }
    const result = JSON.parse(body) as { boards: number; tasks: number };
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Import complete",
      message: `Imported ${result.boards} board(s) and ${result.tasks} task(s) into your account.`,
    });
    mainWindow.webContents.reload();
    return result;
  } catch (error) {
    dialog.showErrorBox("Import failed", String(error));
    return { error: String(error) };
  }
}

function refreshMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      mode: activeMode,
      onEnableSync: () => void enableSync(),
      onSwitchLocal: () => switchToLocal(),
      onImportLocal: () => void importLocalWorkspace(),
    }),
  );
}

/** IPC the in-app Settings menu uses to drive the same workspace actions. */
function registerIpc(): void {
  ipcMain.handle("masar:get-state", () => getDesktopState());
  ipcMain.handle("masar:enable-sync", () => enableSync());
  ipcMain.handle("masar:switch-local", () => switchToLocal());
  ipcMain.handle("masar:import-local", () => importLocalWorkspace());
}

app.on("before-quit", () => {
  shuttingDown = true;
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

process.on("uncaughtException", (error) => log(`[process] uncaughtException: ${error.stack ?? error.message}`));
process.on("unhandledRejection", (reason) => log(`[process] unhandledRejection: ${String(reason)}`));
