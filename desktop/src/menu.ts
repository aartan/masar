import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

export interface MenuContext {
  onOpenAccount: () => void;
  onSyncNow: () => void;
  onImportLocal: () => void;
  canImportLocal: boolean;
  workspaceLabel: string;
}

/** Platform-appropriate native menu with workspace and sync actions. */
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

  template.push({
    label: "File",
    submenu: isMac ? [{ role: "close" }] : [{ role: "quit" }],
  });

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

  template.push({
    label: "Workspace",
    submenu: [
      { label: "Account…", click: ctx.onOpenAccount },
      { label: "Sync Now", click: ctx.onSyncNow },
      ...(ctx.canImportLocal
        ? [{ label: "Import Local Workspace", click: ctx.onImportLocal }]
        : []),
      { type: "separator" },
      {
        label: ctx.workspaceLabel,
        enabled: false,
      },
    ],
  });

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
        label: "Masar on GitHub",
        click: () => shell.openExternal("https://github.com/aartan/masar"),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}
