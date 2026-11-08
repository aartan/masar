import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Search, TriangleAlert } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { SidebarContent } from "@/components/layout/sidebar";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { CreateBoardDialog } from "@/components/board/create-board-dialog";
import { CommandPalette } from "@/components/search/command-palette";
import { ShortcutsDialog } from "@/components/search/shortcuts-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    projects,
    boards,
    user,
    conflictCount,
    loading,
    error,
    refresh,
    reorderProjects,
    moveBoards,
  } = useWorkspace();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [createBoard, setCreateBoard] = React.useState<{
    open: boolean;
    projectId: string | null;
  }>({ open: false, projectId: null });

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }

      if (event.key === "?" && !typing) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function openCreateBoard(projectId: string | null = null) {
    setMobileOpen(false);
    setCreateBoard({ open: true, projectId });
  }

  if (error) {
    return (
      <div className="grid h-dvh place-items-center bg-background px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-semibold">Masar could not open the workspace</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button className="mt-5" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="w-full">
          {loading ? (
            <SidebarSkeleton />
          ) : (
            <div className="h-full animate-fade">
              <SidebarContent
                projects={projects}
                boards={boards}
                conflictCount={conflictCount}
                user={user}
                onOpenSearch={() => setSearchOpen(true)}
                onCreateBoard={openCreateBoard}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onReorderProjects={reorderProjects}
                onMoveBoards={moveBoards}
                onRefresh={refresh}
              />
            </div>
          )}
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Workspace navigation and board list
            </SheetDescription>
          </SheetHeader>
          {loading ? (
            <SidebarSkeleton />
          ) : (
            <div className="h-full animate-fade">
              <SidebarContent
                projects={projects}
                boards={boards}
                conflictCount={conflictCount}
                user={user}
                onOpenSearch={() => {
                  setMobileOpen(false);
                  setSearchOpen(true);
                }}
                onCreateBoard={openCreateBoard}
                onOpenShortcuts={() => {
                  setMobileOpen(false);
                  setShortcutsOpen(true);
                }}
                onNavigate={() => setMobileOpen(false)}
                showClose
                onClose={() => setMobileOpen(false)}
                onReorderProjects={reorderProjects}
                onMoveBoards={moveBoards}
                onRefresh={refresh}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/80 px-3 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-4.5" />
          </Button>
          <Logo />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
            >
              <Search className="size-4" />
            </Button>
          </div>
        </header>

        {conflictCount > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning/25 bg-warning/10 px-4 py-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-warning">
              <TriangleAlert className="size-3.5" />
              {conflictCount} sync conflict{conflictCount === 1 ? "" : "s"} need
              your review
            </span>
            <span className="text-muted-foreground">
              Changes made on different devices are waiting for you to choose a
              version.
            </span>
            <Link
              to="/conflicts"
              className="ml-auto font-medium text-primary hover:underline"
            >
              Review conflicts
            </Link>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden bg-background">
          <div key={location.pathname} className="h-full">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        boards={boards}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CreateBoardDialog
        open={createBoard.open}
        projectId={createBoard.projectId}
        onOpenChange={(open) =>
          setCreateBoard((state) => ({ ...state, open }))
        }
        onCreated={() => void refresh()}
      />
    </div>
  );
}

/**
 * Mirrors the real sidebar's structure and spacing so the workspace boot does
 * not shift the shell when project data arrives.
 */
function SidebarSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading workspace navigation</span>
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <Logo />
      </div>

      <div className="px-3 pb-3">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>

      <div className="space-y-1 px-3">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="size-4 rounded" />
        </div>
        <div className="space-y-1.5 px-3 pt-1.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton
              key={index}
              className={
                index === 0 ? "h-7 w-full rounded-lg" : "h-6 w-[88%] rounded-lg"
              }
            />
          ))}
        </div>
      </div>

      <div className="mt-auto border-t border-sidebar-border/80 px-3 py-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2 w-32" />
          </div>
          <Skeleton className="size-3.5 rounded" />
        </div>
      </div>
    </div>
  );
}
