"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Kbd } from "@/components/shared/empty-state";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import type { BoardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarContentProps {
  boards: BoardSummary[];
  user: { name: string; email: string };
  onOpenSearch: () => void;
  onCreateBoard: () => void;
  onOpenShortcuts: () => void;
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}

export function SidebarContent({
  boards,
  user,
  onOpenSearch,
  onCreateBoard,
  onOpenShortcuts,
  onNavigate,
  showClose,
  onClose,
}: SidebarContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Could not sign out.");
      onNavigate?.();
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out", {
        description: "Please try again.",
      });
      setSigningOut(false);
    }
  }

  const initial = (user.name.trim()[0] ?? user.email[0] ?? "M").toUpperCase();

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <Logo />
        {showClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="group flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/50 px-2.5 text-[13px] text-muted-foreground shadow-[0_1px_0_oklch(1_0_0/0.4)_inset] transition-colors hover:border-sidebar-border/80 hover:bg-background/80 hover:text-foreground"
        >
          <Search className="size-3.5 opacity-70" />
          <span>Search</span>
          <span className="ml-auto flex items-center gap-0.5">
            <Kbd className="h-[18px] min-w-[18px] border-sidebar-border bg-sidebar text-[9px]">
              ⌘
            </Kbd>
            <Kbd className="h-[18px] min-w-[18px] border-sidebar-border bg-sidebar text-[9px]">
              K
            </Kbd>
          </span>
        </button>
      </div>

      <nav className="px-3" aria-label="Workspace">
        <SidebarLink
          href="/"
          icon={LayoutDashboard}
          active={pathname === "/"}
          onClick={onNavigate}
        >
          Overview
        </SidebarLink>
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-1.5">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase">
            Boards
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCreateBoard}
                className="grid size-5 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                aria-label="Create board"
              >
                <Plus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New board</TooltipContent>
          </Tooltip>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {boards.length === 0 ? (
            <div className="mx-2 rounded-lg border border-dashed border-sidebar-border px-3 py-4 text-center">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                No boards yet.
              </p>
              <button
                type="button"
                onClick={onCreateBoard}
                className="mt-1.5 text-[11.5px] font-medium text-primary hover:underline"
              >
                Create your first board
              </button>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {boards.map((board) => {
                const active = pathname === `/boards/${board.id}`;
                return (
                  <li key={board.id}>
                    <Link
                      href={`/boards/${board.id}`}
                      onClick={onNavigate}
                      className={cn(
                        "group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          BOARD_COLOR_CLASS[board.color],
                          "board-dot",
                          active ? "opacity-100" : "opacity-70",
                        )}
                      />
                      <span className="truncate">{board.name}</span>
                      {board.taskCount > 0 && (
                        <span
                          className={cn(
                            "ml-auto text-[10px] tabular-nums",
                            active
                              ? "text-sidebar-accent-foreground/60"
                              : "text-muted-foreground/50",
                          )}
                        >
                          {board.taskCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={onCreateBoard}
            className="mt-1 flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[12.5px] text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <Plus className="size-3.5" />
            New board
          </button>
        </div>
      </div>

      <div className="mt-auto border-t border-sidebar-border/80 px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60 disabled:opacity-60"
              disabled={signingOut}
              aria-label="Account menu"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[232px]">
            <DropdownMenuLabel>Personal workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void signOut()}
              disabled={signingOut}
            >
              <LogOut />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mt-1 flex items-center gap-1">
          <ThemeToggle withLabel />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onOpenShortcuts}
                aria-label="Keyboard shortcuts"
                className="text-muted-foreground"
              >
                <Keyboard className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Keyboard shortcuts</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  active,
  children,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-4 opacity-70" />
      {children}
    </Link>
  );
}
