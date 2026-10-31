import * as React from "react";
import { Menu, Search } from "lucide-react";

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
  const { boards, user, loading, error, refreshBoards } = useWorkspace();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [createBoardOpen, setCreateBoardOpen] = React.useState(false);

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

  function openCreateBoard() {
    setMobileOpen(false);
    setCreateBoardOpen(true);
  }

  if (loading) {
    return (
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border p-4 lg:block">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-8 h-9 w-full" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 items-center justify-center">
          <div className="w-full max-w-md px-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-3 h-3.5 w-72 max-w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-dvh place-items-center bg-background px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-semibold">Masar could not open the workspace</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button className="mt-5" onClick={() => void refreshBoards()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border lg:flex">
        <div className="w-full">
          <SidebarContent
            boards={boards}
            user={user}
            onOpenSearch={() => setSearchOpen(true)}
            onCreateBoard={openCreateBoard}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
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
          <SidebarContent
            boards={boards}
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
          />
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

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <CommandPalette
        boards={boards}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CreateBoardDialog
        open={createBoardOpen}
        onOpenChange={setCreateBoardOpen}
        onCreated={() => void refreshBoards()}
      />
    </div>
  );
}
