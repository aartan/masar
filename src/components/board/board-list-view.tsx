"use client";

import * as React from "react";
import { ChevronRight, ListChecks, MessageSquare, SearchX } from "lucide-react";

import {
  AssigneeAvatar,
  DueDateChip,
  LabelChip,
  PriorityBars,
} from "@/components/shared/task-meta";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { BoardColumn, Label, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BoardListView({
  tasks,
  columns,
  labels,
  onOpenTask,
  onClearFilters,
  filtered,
}: {
  tasks: Task[];
  columns: BoardColumn[];
  labels: Label[];
  onOpenTask: (taskId: string) => void;
  onClearFilters: () => void;
  filtered: boolean;
}) {
  const columnMap = new Map(columns.map((column) => [column.id, column]));

  if (tasks.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={filtered ? SearchX : ListChecks}
          title={filtered ? "No tasks match" : "No tasks yet"}
          description={
            filtered
              ? "Try removing a filter or searching for something else."
              : "Add a task from any column to see it here."
          }
          action={
            filtered ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="text-[12px] font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 sm:px-6">
        <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card shadow-soft md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border/70 bg-muted/25 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
                  <th className="px-4 py-2.5 font-semibold">Task</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Priority</th>
                  <th className="px-3 py-2.5 font-semibold">Due</th>
                  <th className="px-3 py-2.5 font-semibold">Labels</th>
                  <th className="px-3 py-2.5 font-semibold">Assignee</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tasks.map((task) => {
                  const column = columnMap.get(task.columnId);
                  const taskLabels = task.labelIds
                    .map((id) => labels.find((label) => label.id === id))
                    .filter((label): label is Label => Boolean(label));
                  return (
                    <tr
                      key={task.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open task: ${task.title}`}
                      onClick={() => onOpenTask(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenTask(task.id);
                        }
                      }}
                      className="group cursor-pointer transition-colors hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none"
                    >
                      <td className="max-w-[360px] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              column?.isDone
                                ? "bg-primary/60"
                                : "bg-muted-foreground/30",
                            )}
                          />
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-[13px] font-medium",
                                column?.isDone && "text-muted-foreground",
                              )}
                            >
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="mt-0.5 max-w-[320px] truncate text-[11px] text-muted-foreground/70">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </div>
                        {(task.subtaskCount > 0 || task.commentCount > 0) && (
                          <div className="mt-1 flex items-center gap-2 pl-3.5 text-[10px] text-muted-foreground/60">
                            {task.subtaskCount > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <ListChecks className="size-3" />
                                {task.subtaskDoneCount}/{task.subtaskCount}
                              </span>
                            )}
                            {task.commentCount > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <MessageSquare className="size-3" />
                                {task.commentCount}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline" className="max-w-[120px] truncate">
                          {column?.name ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <PriorityBars priority={task.priority} />
                          <span className="capitalize">
                            {task.priority === "none" ? "—" : task.priority}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <DueDateChip
                          task={task}
                          columnDone={column?.isDone}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[190px] flex-wrap gap-1">
                          {taskLabels.slice(0, 2).map((label) => (
                            <LabelChip key={label.id} label={label} />
                          ))}
                          {taskLabels.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{taskLabels.length - 2}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2">
                          <AssigneeAvatar name={task.assignee} />
                          <span className="max-w-[100px] truncate text-[11.5px] text-muted-foreground">
                            {task.assignee ?? "Unassigned"}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ChevronRight className="size-3.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2 md:hidden">
          {tasks.map((task) => {
            const column = columnMap.get(task.columnId);
            const taskLabels = task.labelIds
              .map((id) => labels.find((label) => label.id === id))
              .filter((label): label is Label => Boolean(label));
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                className="w-full rounded-xl border border-border/75 bg-card p-3 text-left shadow-soft transition-colors hover:border-border"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{column?.name ?? "—"}</Badge>
                  <div className="flex items-center gap-1.5">
                    <PriorityBars priority={task.priority} />
                    <DueDateChip task={task} columnDone={column?.isDone} />
                  </div>
                </div>
                <p
                  className={cn(
                    "mt-2 text-[13px] font-medium",
                    column?.isDone && "text-muted-foreground",
                  )}
                >
                  {task.title}
                </p>
                {taskLabels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {taskLabels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </div>
                )}
                <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-muted-foreground/70">
                  <span>{task.assignee ?? "Unassigned"}</span>
                  <span className="flex items-center gap-2">
                    {task.subtaskCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <ListChecks className="size-3" />
                        {task.subtaskDoneCount}/{task.subtaskCount}
                      </span>
                    )}
                    {task.commentCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquare className="size-3" />
                        {task.commentCount}
                      </span>
                    )}
                    <AssigneeAvatar name={task.assignee} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
