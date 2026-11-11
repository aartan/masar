import * as React from "react";

/**
 * Whether the device currently has network connectivity, based on
 * `navigator.onLine` and the browser's online/offline events. In the desktop
 * app the local API keeps accepting writes while offline (they synchronize
 * later), so this only drives the "saved on this device" indicator.
 */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState<boolean>(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
