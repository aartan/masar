"use client";

import * as React from "react";
import { Menu, Search } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { SidebarContent } from "@/components/layout/sidebar";
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
import type { BoardSummary } from "@/lib/types";

export function AppShell({
  boards,
  user,
  isLocalMode = false,
  children,
}: {
  boards: BoardSummary[];
  user: { name: string; email: string };
  isLocalMode?: boolean;
  children: React.ReactNode;
}) {
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

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
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

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border lg:flex">
        <div className="w-full">
          <SidebarContent
            boards={boards}
            user={user}
            isLocalMode={isLocalMode}
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
            isLocalMode={isLocalMode}
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
      />
    </div>
  );
}
