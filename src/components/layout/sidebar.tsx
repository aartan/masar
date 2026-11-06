import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  ChevronsUpDown,
  GripVertical,
  Keyboard,
  LayoutDashboard,
  Palette,
  Plus,
  Search,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/brand/logo";
import { Kbd } from "@/components/shared/empty-state";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { useTheme, type Theme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSyncStatus } from "@/lib/use-sync-status";
import type { BoardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarContentProps {
  boards: BoardSummary[];
  user: { name: string; email: string };
  onOpenSearch: () => void;
  onCreateBoard: () => void;
  onOpenShortcuts: () => void;
  onReorderBoards: (boardIds: string[]) => Promise<void>;
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
  onReorderBoards,
  onNavigate,
  showClose,
  onClose,
}: SidebarContentProps) {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const sync = useSyncStatus();
  const initial = (user.name.trim()[0] ?? user.email[0] ?? "M").toUpperCase();
  const boardsDndId = React.useId();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
      bypassActivationConstraint: ({ event }) =>
        event.target instanceof Element &&
        Boolean(event.target.closest("[data-board-drag-handle]")),
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleBoardDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = boards.findIndex((board) => board.id === active.id);
    const newIndex = boards.findIndex((board) => board.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextBoards = arrayMove(boards, oldIndex, newIndex);
    void onReorderBoards(nextBoards.map((board) => board.id)).catch(
      (error) => {
        toast.error("Could not reorder boards", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      },
    );
  }

  const syncLabel =
    sync?.phase === "syncing"
      ? "Syncing…"
      : sync?.phase === "error"
        ? "Sync needs attention"
        : sync?.phase === "subscription_required"
          ? "Subscription required"
          : sync?.phase === "idle"
            ? "Cloud sync enabled"
            : "Sign in to enable sync";

  function openAccount() {
    onNavigate?.();
    navigate("/account");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <Logo />
        {showClose && (
          <div className="flex items-center gap-1">
            <ThemeToggle showTooltip={false} />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </Button>
          </div>
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
        <SidebarLink
          href="/calendar"
          icon={CalendarDays}
          active={pathname === "/calendar"}
          onClick={onNavigate}
        >
          Calendar
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
            <DndContext
              id={boardsDndId}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleBoardDragEnd}
            >
              <SortableContext
                items={boards.map((board) => board.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-0.5">
                  {boards.map((board) => (
                    <SortableBoardLink
                      key={board.id}
                      board={board}
                      active={pathname === `/boards/${board.id}`}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
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
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
              aria-label="Account menu"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {syncLabel}
                </p>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[248px]">
            <DropdownMenuLabel>Settings</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette />
                Appearance
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                  <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onOpenShortcuts}>
              <Keyboard />
              Keyboard shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openAccount}>
              <UserRound />
              Account
            </DropdownMenuItem>
            {sync?.lastSyncedAt && (
              <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">
                Last synced{" "}
                {new Date(sync.lastSyncedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </DropdownMenuLabel>
            )}
            {sync?.phase === "error" && sync.lastError && (
              <DropdownMenuItem
                onSelect={() => void window.masarDesktop?.syncNow()}
                className="text-amber-700 dark:text-amber-300"
              >
                <Settings2 />
                Retry sync
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function SortableBoardLink({
  board,
  active,
  onNavigate,
}: {
  board: BoardSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });
  const handlePointerDown = listeners?.onPointerDown as
    | React.PointerEventHandler<HTMLElement>
    | undefined;

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      data-board-id={board.id}
      className={cn("group/board", isDragging && "relative z-20 opacity-60")}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg pr-1 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <Link
          to={`/boards/${board.id}`}
          onClick={onNavigate}
          onPointerDown={handlePointerDown}
          draggable={false}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-board-drag-handle=""
          className="grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:cursor-grabbing sm:text-muted-foreground/0 sm:group-hover/board:text-muted-foreground/50 sm:group-focus-within/board:text-muted-foreground/50"
          aria-label={`Reorder board ${board.name}`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>
    </li>
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
      to={href}
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
