import * as React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/app-shell";
import { DesktopNavigation } from "@/components/layout/desktop-navigation";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { WorkspaceProvider } from "@/components/layout/workspace-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardPage } from "@/pages/board-page";
import { NotFoundPage } from "@/pages/not-found-page";
import OverviewPage from "@/pages/overview-page";
import { SyncPage } from "@/pages/sync-page";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-dvh place-items-center bg-background px-6">
          <div className="max-w-md text-center">
            <h1 className="font-display text-xl font-semibold">
              Something went wrong
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Your local data is safe. Reload the window to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
            >
              Reload Masar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <OfflineBanner />
        <AppErrorBoundary>
          <BrowserRouter>
            <DesktopNavigation />
            <WorkspaceProvider>
              <AppShell>
                <Routes>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/boards/:boardId" element={<BoardPage />} />
                  <Route path="/settings/sync" element={<SyncPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </AppShell>
            </WorkspaceProvider>
          </BrowserRouter>
        </AppErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
