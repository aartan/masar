import * as React from "react";

/**
 * Run a callback after a desktop sync cycle finishes. The latest callback is
 * kept in a ref so pages do not need to unsubscribe/re-subscribe on every
 * render. The workspace provider uses the same event for the sidebar; pages use
 * this hook to refresh their own server-backed data.
 */
export function useOnSyncComplete(callback: () => void): void {
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  React.useEffect(() => {
    const bridge = window.masarDesktop;
    if (!bridge) return;
    let previousPhase = "";
    return bridge.onSyncStatus((status) => {
      const completed = previousPhase === "syncing" && status.phase === "idle";
      previousPhase = status.phase;
      if (completed) callbackRef.current();
    });
  }, []);
}
