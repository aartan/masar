"use client";

import * as React from "react";
import {
  ArrowUpDown,
  CalendarClock,
  ChevronDown,
  CircleX,
  Flag,
  ListFilter,
  Search,
  Tag,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PriorityBars } from "@/components/shared/task-meta";
import { LABEL_COLOR_SWATCH } from "@/components/shared/colors";
import { PRIORITIES, PRIORITY_META, SORT_LABELS, DUE_FILTER_LABELS, TASK_SORTS, DUE_FILTERS } from "@/lib/constants";
import type { TaskSort, DueFilter, Priority } from "@/lib/constants";
import type { BoardColumn, Label } from "@/lib/types";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type TaskFilters,
} from "@/lib/task-utils";
import { cn } from "@/lib/utils";

export function FilterBar({
  filters,
  onChange,
  columns,
  labels,
  visibleCount,
  totalCount,
}: {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  columns: BoardColumn[];
  labels: Label[];
  visibleCount: number;
  totalCount: number;
}) {
  const active = hasActiveFilters(filters);
  const activeCount =
    (filters.query.trim() ? 1 : 0) +
    filters.priorities.length +
    filters.labelIds.length +
    (filters.due !== "any" ? 1 : 0) +
    (filters.columnId ? 1 : 0);

  function update(patch: Partial<TaskFilters>) {
    onChange({ ...filters, ...patch });
  }

  function togglePriority(priority: Priority, checked: boolean) {
    update({
      priorities: checked
        ? [...filters.priorities, priority]
        : filters.priorities.filter((item) => item !== priority),
    });
  }

  function toggleLabel(labelId: string, checked: boolean) {
    update({
      labelIds: checked
        ? [...filters.labelIds, labelId]
        : filters.labelIds.filter((item) => item !== labelId),
    });
  }

  const selectedStatus = filters.columnId
    ? columns.find((column) => column.id === filters.columnId)?.name
    : "Status";

  return (
    <div
      role="toolbar"
      aria-label="Board filters"
      className="flex flex-wrap items-center gap-2"
    >
      <div className="relative min-w-[170px] max-w-[300px] flex-1 sm:flex-none sm:basis-[260px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          placeholder="Search this board…"
          aria-label="Search tasks on this board"
          className="h-8 bg-card/60 pl-8 text-[12.5px]"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => update({ query: "" })}
            className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <FilterMenu
        label={
          filters.priorities.length > 0
            ? `Priority · ${filters.priorities.length}`
            : "Priority"
        }
        icon={Flag}
        active={filters.priorities.length > 0}
      >
        <DropdownMenuLabel>Priority</DropdownMenuLabel>
        {PRIORITIES.map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={filters.priorities.includes(priority)}
            onCheckedChange={(checked) =>
              togglePriority(priority, checked === true)
            }
          >
            <PriorityBars priority={priority} />
            {PRIORITY_META[priority].label}
          </DropdownMenuCheckboxItem>
        ))}
        {filters.priorities.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => update({ priorities: [] })}
              className="text-muted-foreground"
            >
              Clear priority
            </DropdownMenuItem>
          </>
        )}
      </FilterMenu>

      <FilterMenu
        label={
          filters.labelIds.length > 0
            ? `Labels · ${filters.labelIds.length}`
            : "Labels"
        }
        icon={Tag}
        active={filters.labelIds.length > 0}
      >
        <DropdownMenuLabel>Labels</DropdownMenuLabel>
        {labels.length === 0 ? (
          <DropdownMenuItem disabled>No labels on this board</DropdownMenuItem>
        ) : (
          labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={filters.labelIds.includes(label.id)}
              onCheckedChange={(checked) =>
                toggleLabel(label.id, checked === true)
              }
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  LABEL_COLOR_SWATCH[label.color],
                )}
              />
              {label.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {filters.labelIds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => update({ labelIds: [] })}
              className="text-muted-foreground"
            >
              Clear labels
            </DropdownMenuItem>
          </>
        )}
      </FilterMenu>

      <FilterMenu
        label={
          filters.due !== "any" ? DUE_FILTER_LABELS[filters.due] : "Due date"
        }
        icon={CalendarClock}
        active={filters.due !== "any"}
      >
        <DropdownMenuLabel>Due date</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={filters.due}
          onValueChange={(value) => update({ due: value as DueFilter })}
        >
          {DUE_FILTERS.map((due) => (
            <DropdownMenuRadioItem key={due} value={due}>
              {DUE_FILTER_LABELS[due]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </FilterMenu>

      <FilterMenu
        label={selectedStatus ?? "Status"}
        icon={ListFilter}
        active={Boolean(filters.columnId)}
      >
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={filters.columnId ?? "all"}
          onValueChange={(value) =>
            update({ columnId: value === "all" ? null : value })
          }
        >
          <DropdownMenuRadioItem value="all">
            All statuses
          </DropdownMenuRadioItem>
          {columns.map((column) => (
            <DropdownMenuRadioItem key={column.id} value={column.id}>
              {column.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </FilterMenu>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-[11px] tabular-nums text-muted-foreground/70 sm:inline">
          {active
            ? `${visibleCount} of ${totalCount}`
            : `${totalCount} task${totalCount === 1 ? "" : "s"}`}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground"
            >
              <ArrowUpDown className="size-3.5" />
              <span className="hidden sm:inline">
                {SORT_LABELS[filters.sort]}
              </span>
              <span className="sm:hidden">Sort</span>
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort tasks</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.sort}
              onValueChange={(value) =>
                update({ sort: value as TaskSort })
              }
            >
              {TASK_SORTS.map((sort) => (
                <DropdownMenuRadioItem key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground"
          >
            <CircleX className="size-3.5" />
            Clear
            {activeCount > 0 && (
              <span className="grid size-4 place-items-center rounded-full bg-accent text-[9px] font-semibold text-accent-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterMenu({
  label,
  icon: Icon,
  active,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
            active
              ? "border-primary/30 bg-primary/8 text-primary"
              : "border-border bg-card/50 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          <span className="max-w-[110px] truncate">{label}</span>
          <ChevronDown className="size-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
