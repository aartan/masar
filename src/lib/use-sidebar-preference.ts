import * as React from "react";

const STORAGE_KEY = "masar:sidebar";

export type SidebarMode = "expanded" | "collapsed";

function readMode(): SidebarMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "collapsed" || raw === "expanded") return raw;
    if (raw) {
      // Legacy value written while the sidebar had a third "hidden" state.
      const parsed = JSON.parse(raw) as { mode?: unknown } | null;
      if (parsed?.mode === "collapsed") return "collapsed";
    }
    return "expanded";
  } catch {
    return "expanded";
  }
}

/** Persists the desktop sidebar's expanded/collapsed state across reloads. */
export function useSidebarPreference() {
  const [mode, setMode] = React.useState<SidebarMode>(readMode);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage can be unavailable in restricted contexts. */
    }
  }, [mode]);

  const toggleCollapsed = React.useCallback(() => {
    setMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
  }, []);

  return {
    collapsed: mode === "collapsed",
    toggleCollapsed,
  };
}
