/**
 * Type-only description of the Electron preload bridge. The hosted web app has
 * no `window.masarDesktop`, so UI must always guard for its absence.
 */
export interface MasarDesktopState {
  isDesktop: boolean;
  mode: "local" | "sync";
}

export interface MasarDesktopBridge {
  getState(): Promise<MasarDesktopState>;
  enableSync(): Promise<{ ok: boolean; error?: string }>;
  switchToLocal(): Promise<void>;
  importLocal(): Promise<unknown>;
}

declare global {
  interface Window {
    masarDesktop?: MasarDesktopBridge;
  }
}
