import { contextBridge, ipcRenderer } from "electron";

import type {
  AccountDeletionResult,
  PremiumCredentials,
  PremiumRegistration,
  PremiumStatus,
  SyncStatus,
} from "../../src/lib/premium-types";
import type { DesktopState, ThemePreference } from "../../src/lib/desktop-bridge";
import { cleanError } from "./user-facing-error";

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    throw cleanError(error);
  }
}

const initialTheme = ipcRenderer.sendSync("masar:get-theme") as ThemePreference;

contextBridge.exposeInMainWorld("masarDesktop", {
  initialTheme,
  setTheme: (theme: ThemePreference) =>
    invoke<ThemePreference>("masar:set-theme", theme),
  getState: () => invoke<DesktopState>("masar:get-state"),
  getPremiumStatus: () => invoke<PremiumStatus>("masar:get-premium-status"),
  login: (input: PremiumCredentials) =>
    invoke<PremiumStatus>("masar:premium-login", input),
  register: (input: PremiumRegistration) =>
    invoke<PremiumStatus>("masar:premium-register", input),
  logout: () => invoke<PremiumStatus>("masar:premium-logout"),
  deleteAccount: (confirmation: string) =>
    invoke<AccountDeletionResult>("masar:premium-delete-account", confirmation),
  startCheckout: () => invoke<{ url: string }>("masar:start-checkout"),
  openPortal: () => invoke<{ url: string }>("masar:open-portal"),
  refreshBilling: () => invoke<PremiumStatus>("masar:refresh-billing"),
  syncNow: () => invoke<SyncStatus>("masar:sync-now"),
  getSyncStatus: () => invoke<SyncStatus>("masar:get-sync-status"),
  resolveSyncConflict: (conflictId: string, choice: "cloud" | "local") =>
    invoke<void>("masar:resolve-sync-conflict", { conflictId, choice }),
  importLocalWorkspace: () =>
    invoke<{ boards: number; tasks: number }>("masar:import-local"),
  notifyDataChanged: () => invoke<void>("masar:notify-data-change"),
  onSyncStatus: (listener: (status: SyncStatus) => void) => {
    const handler = (_event: unknown, status: SyncStatus) => listener(status);
    ipcRenderer.on("masar:sync-status", handler);
    return () => ipcRenderer.removeListener("masar:sync-status", handler);
  },
  onNavigate: (listener: (path: string) => void) => {
    const handler = (_event: unknown, path: string) => listener(path);
    ipcRenderer.on("masar:navigate", handler);
    return () => ipcRenderer.removeListener("masar:navigate", handler);
  },
});
