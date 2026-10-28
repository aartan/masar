import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal secure bridge so the in-app Settings menu can drive desktop-only
 * workspace actions (sync). Exposed only in the Electron build; the hosted web
 * app has no `window.masarDesktop`, so its UI falls back to web behavior.
 */
contextBridge.exposeInMainWorld("masarDesktop", {
  getState: () => ipcRenderer.invoke("masar:get-state"),
  unlockPremium: () => ipcRenderer.invoke("masar:unlock-premium"),
  enableSync: () => ipcRenderer.invoke("masar:enable-sync"),
  switchToLocal: () => ipcRenderer.invoke("masar:switch-local"),
  importLocal: () => ipcRenderer.invoke("masar:import-local"),
});
