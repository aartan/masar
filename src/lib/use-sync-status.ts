import * as React from "react";

import type { SyncStatus } from "@/lib/premium-types";

/**
 * Reads sync status from the Electron bridge. In a browser tab there is no
 * bridge, so premium sync UI stays hidden and local work continues normally.
 */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);

  React.useEffect(() => {
    const bridge = window.masarDesktop;
    if (!bridge) return;
    let active = true;
    void bridge.getSyncStatus().then((next) => {
      if (active) setStatus(next);
    });
    const unsubscribe = bridge.onSyncStatus((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return status;
}
