"use client";

import * as React from "react";
import { LaptopMinimal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MasarDesktopState } from "@/lib/desktop-bridge";

/**
 * Electron sync builds can always fall back to the free local workspace, even
 * when online access is restricted. Rendered only when the desktop bridge says
 * the current mode is "sync".
 */
export function DesktopOfflineOption({
  className,
}: {
  className?: string;
}) {
  const [available, setAvailable] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    const api = window.masarDesktop;
    if (!api) return;
    let active = true;
    void api
      .getState()
      .then((state: MasarDesktopState) => {
        if (active) setAvailable(state.mode === "sync");
      })
      .catch(() => {
        /* Not available outside the desktop shell. */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!available) return null;

  return (
    <div
      className={
        className ??
        "rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-center"
      }
    >
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Work offline for free in your local workspace.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        disabled={switching}
        onClick={() => {
          if (switching) return;
          setSwitching(true);
          void window.masarDesktop?.switchToLocal();
        }}
      >
        <LaptopMinimal className="size-3.5" />
        {switching ? "Opening local workspace…" : "Continue offline"}
      </Button>
    </div>
  );
}
