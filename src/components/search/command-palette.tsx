"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CornerDownLeft,
  LayoutDashboard,
  Loader2,
  Search,
  SearchX,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PriorityBars, DueDateChip } from "@/components/shared/task-meta";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { Kbd } from "@/components/shared/empty-state";
import type { BoardSummary, SearchResult } from "@/lib/types";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type NavItem = {
  kind: "nav";
  key: string;
  title: string;
  subtitle: string;
  href: string;
  boardColor?: BoardSummary["color"];
  isOverview?: boolean;
};

type TaskItem = {
  kind: "task";
  key: string;
  task: SearchResult;
  href: string;
};

type PaletteItem = NavItem | TaskItem;

export function CommandPalette({
  boards,
  open,
  onOpenChange,
}: {
  boards: BoardSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setActiveIndex(0);
    }
    onOpenChange(next);
  }

  React.useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length === 0) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const data = await api<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (!cancelled) setResults(data.results);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, open]);

  const items = React.useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim().toLowerCase();
    const navItems: PaletteItem[] = [];

    if (!trimmed || "overview".includes(trimmed) || "dashboard".includes(trimmed)) {
      navItems.push({
        kind: "nav",
        key: "nav-overview",
        title: "Overview",
        subtitle: "Dashboard and workload",
        href: "/",
        isOverview: true,
      });
    }

    for (const board of boards) {
      if (trimmed && !board.name.toLowerCase().includes(trimmed)) continue;
      navItems.push({
        kind: "nav",
        key: `nav-board-${board.id}`,
        title: board.name,
        subtitle: `${board.taskCount} ${board.taskCount === 1 ? "task" : "tasks"}`,
        href: `/boards/${board.id}`,
        boardColor: board.color,
      });
    }

    const taskItems: PaletteItem[] = trimmed
      ? results.map((task) => ({
          kind: "task",
          key: `task-${task.taskId}`,
          task,
          href: `/boards/${task.boardId}?task=${task.taskId}`,
        }))
      : [];

    return [...navItems, ...taskItems];
  }, [boards, query, results]);

  const activeItemIndex =
    items.length === 0 ? 0 : Math.min(activeIndex, items.length - 1);

  React.useEffect(() => {
    const element = document.getElementById(`palette-item-${activeItemIndex}`);
    element?.scrollIntoView({ block: "nearest" });
  }, [activeItemIndex]);

  function select(item: PaletteItem | undefined) {
    if (!item) return;
    handleOpenChange(false);
    router.push(item.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(
        items.length === 0 ? 0 : (activeItemIndex + 1) % items.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        items.length === 0
          ? 0
          : (activeItemIndex - 1 + items.length) % items.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(items[activeItemIndex]);
    }
  }

  const hasQuery = query.trim().length > 0;
  const navCount = items.filter((item) => item.kind === "nav").length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[14%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:top-[18%]"
      >
        <DialogTitle className="sr-only">Search Masar</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          <Search className="size-4 shrink-0 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              setActiveIndex(0);
              if (!value.trim()) {
                setResults([]);
                setLoading(false);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks or jump to a board…"
            className="h-13 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            aria-label="Search tasks and boards"
            aria-controls="command-results"
            aria-activedescendant={
              items.length > 0
                ? `palette-item-${activeItemIndex}`
                : undefined
            }
            autoFocus
          />
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
          ) : (
            <Kbd>esc</Kbd>
          )}
        </div>

        <div
          id="command-results"
          role="listbox"
          className="scrollbar-thin max-h-[min(26rem,60vh)] overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <SearchX className="size-5" strokeWidth={1.7} />
              </div>
              <p className="text-[13px] font-medium">
                {loading ? "Searching…" : "No matches"}
              </p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                {loading
                  ? "Looking through every task on your boards."
                  : "Try a different title, or jump to a board instead."}
              </p>
            </div>
          ) : (
            <>
              {items.slice(0, navCount).length > 0 && (
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/60 uppercase">
                  {hasQuery ? "Jump to" : "Go to"}
                </p>
              )}
              {items.map((item, index) => {
                const active = index === activeItemIndex;
                if (item.kind === "nav") {
                  return (
                    <button
                      key={item.key}
                      id={`palette-item-${index}`}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                        active ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/60 bg-card">
                        {item.isOverview ? (
                          <LayoutDashboard className="size-3.5 text-muted-foreground" />
                        ) : (
                          <span
                            className={cn(
                              "size-2.5 rounded-full",
                              item.boardColor
                                ? BOARD_COLOR_CLASS[item.boardColor]
                                : "",
                              "board-dot",
                            )}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {item.title}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {item.subtitle}
                        </span>
                      </span>
                      {active && (
                        <CornerDownLeft className="size-3.5 text-muted-foreground" />
                      )}
                    </button>
                  );
                }

                if (
                  index === navCount &&
                  items.slice(navCount).length > 0
                ) {
                  return (
                    <React.Fragment key={item.key}>
                      <p className="px-2.5 pt-4 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/60 uppercase">
                        Tasks
                      </p>
                      <TaskRow
                        item={item}
                        index={index}
                        active={active}
                        onHover={() => setActiveIndex(index)}
                        onSelect={() => select(item)}
                      />
                    </React.Fragment>
                  );
                }

                return (
                  <TaskRow
                    key={item.key}
                    item={item}
                    index={index}
                    active={active}
                    onHover={() => setActiveIndex(index)}
                    onSelect={() => select(item)}
                  />
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border/70 bg-muted/30 px-4 py-2 text-[10.5px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ArrowRight className="size-3" /> tasks open in their board
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  item,
  index,
  active,
  onHover,
  onSelect,
}: {
  item: TaskItem;
  index: number;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const { task } = item;
  return (
    <button
      id={`palette-item-${index}`}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground",
      )}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          BOARD_COLOR_CLASS[task.boardColor],
          "board-dot",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {task.title}
        </span>
        <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          {task.boardName}
          <span className="text-muted-foreground/40">/</span>
          {task.columnName}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <DueDateChip task={{ dueDate: task.dueDate }} />
        <PriorityBars priority={task.priority} />
      </span>
    </button>
  );
}
