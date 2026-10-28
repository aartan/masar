import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

import type { WorkspaceMode } from "./settings";

export interface MenuContext {
  mode: WorkspaceMode;
  premiumUnlocked: boolean;
  onUnlockPremium: () => void;
  onEnableSync: () => void;
  onSwitchLocal: () => void;
  onImportLocal: () => void;
}

/**
 * Build a platform-appropriate native menu, including a Workspace menu that
 * switches between the free local workspace and premium sync.
 *
 * The web UI already binds Cmd/Ctrl+K for global search, so the native menu
 * deliberately does not register that accelerator.
 */
export function buildMenu(ctx: MenuContext): Menu {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({ label: "File", submenu: isMac ? [{ role: "close" }] : [{ role: "quit" }] });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  });

  template.push({ label: "Workspace", submenu: buildWorkspaceSubmenu(ctx) });

  template.push({
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
    ],
  });

  template.push({
    label: "Window",
    submenu: isMac
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [{ role: "minimize" }, { role: "close" }],
  });

  template.push({
    role: "help",
    submenu: [
      {
        label: "Masar on the Web",
        click: () => shell.openExternal("https://next-kanban-gamma.vercel.app/"),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}

function buildWorkspaceSubmenu(ctx: MenuContext): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    {
      label: ctx.mode === "sync" ? "Mode: Sync (premium)" : "Mode: Local (offline)",
      enabled: false,
    },
    { type: "separator" },
  ];

  if (ctx.mode === "local") {
    if (!ctx.premiumUnlocked) {
      items.push({ label: "Unlock Sync (Premium)…", click: ctx.onUnlockPremium });
    }
    items.push({
      label: "Enable Sync Across Devices…",
      enabled: ctx.premiumUnlocked,
      click: ctx.onEnableSync,
    });
  } else {
    items.push({ label: "Import Local Data Into Account…", click: ctx.onImportLocal });
    items.push({ type: "separator" });
    items.push({ label: "Switch to Local Workspace", click: ctx.onSwitchLocal });
  }

  return items;
}
