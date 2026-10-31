import { WifiOff } from "lucide-react";
import * as React from "react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = React.useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );

  React.useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-4"
    >
      <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 px-3.5 py-1.5 text-[12px] font-medium text-amber-900 shadow-lg shadow-black/5 dark:border-amber-400/25 dark:bg-amber-950 dark:text-amber-100">
        <WifiOff className="size-3.5" />
        You&apos;re offline. Local work is saved and premium sync will retry.
      </div>
    </div>
  );
}
