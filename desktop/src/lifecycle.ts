import { app } from "electron";

import type { ServerHandle } from "./server/start";

/**
 * Wire up platform-correct lifecycle behavior. All `process.platform`
 * branching for lifecycle lives here so shared code stays platform-free.
 */
export function registerLifecycle(options: {
  getServer: () => ServerHandle | null;
  createWindow: () => void;
  hasWindow: () => boolean;
}): void {
  const isMac = process.platform === "darwin";

  // macOS apps stay running (in the dock) with no windows; everyone else quits.
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });

  // macOS: clicking the dock icon with no window open recreates one.
  app.on("activate", () => {
    if (!options.hasWindow()) options.createWindow();
  });

  // Always tear down the server child on quit, on every platform, so no
  // orphaned Node process survives the app.
  app.on("will-quit", () => {
    options.getServer()?.kill();
  });
}
