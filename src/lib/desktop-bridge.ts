import type {
  PremiumCredentials,
  PremiumRegistration,
  PremiumStatus,
  SyncStatus,
} from "./premium-types";

export type ThemePreference = "light" | "dark" | "system";

export interface DesktopState {
  isDesktop: true;
  mode: "local";
  version: string;
}

export interface MasarDesktopBridge {
  /** Synchronous startup value so the correct theme paints immediately. */
  initialTheme: ThemePreference;
  setTheme(theme: ThemePreference): Promise<ThemePreference>;
  getState(): Promise<DesktopState>;
  getPremiumStatus(): Promise<PremiumStatus>;
  login(input: PremiumCredentials): Promise<PremiumStatus>;
  register(input: PremiumRegistration): Promise<PremiumStatus>;
  logout(): Promise<PremiumStatus>;
  startCheckout(): Promise<{ url: string }>;
  openPortal(): Promise<{ url: string }>;
  refreshBilling(): Promise<PremiumStatus>;
  syncNow(): Promise<SyncStatus>;
  getSyncStatus(): Promise<SyncStatus>;
  /** Explicit one-way copy of the local workspace into the premium account. */
  importLocalWorkspace(): Promise<{ boards: number; tasks: number }>;
  notifyDataChanged(): Promise<void>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  onNavigate(listener: (path: string) => void): () => void;
}

declare global {
  interface Window {
    masarDesktop?: MasarDesktopBridge;
  }
}
