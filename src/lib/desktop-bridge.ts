import type {
  PremiumCredentials,
  PremiumRegistration,
  PremiumStatus,
  SyncStatus,
} from "./premium-types";

export interface DesktopState {
  isDesktop: true;
  mode: "local";
  version: string;
}

export interface MasarDesktopBridge {
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
  notifyDataChanged(): Promise<void>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  onNavigate(listener: (path: string) => void): () => void;
}

declare global {
  interface Window {
    masarDesktop?: MasarDesktopBridge;
  }
}
