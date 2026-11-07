"use client";

import * as React from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LabelManagerPopover } from "@/components/shared/label-manager-popover";
import { PrioritySelect } from "@/components/shared/priority-select";
import {
  AuthorAvatar,
  LabelChip,
} from "@/components/shared/task-meta";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatRelative } from "@/lib/dates";
import type { Priority } from "@/lib/constants";
import { createLabel, type LabelDraft } from "@/lib/labels";
import type {
  BoardColumn,
  Comment,
  Label as BoardLabel,
  Subtask,
  Task,
  TaskDetail,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskDetailSheet({
  task,
  columns,
  labels,
  open,
  readOnly = false,
  onOpenChange,
  onTaskUpdated,
  onTaskDeleted,
  onTaskDuplicated,
  onLabelCreated,
}: {
  task: Task | null;
  columns: BoardColumn[];
  labels: BoardLabel[];
  open: boolean;
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
  onTaskDuplicated: (task: Task) => void;
  onLabelCreated: (label: BoardLabel) => void;
}) {
  const taskId = task?.id ?? null;
  const [detail, setDetail] = React.useState<TaskDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [subtaskTitle, setSubtaskTitle] = React.useState("");
  const [subtaskEdit, setSubtaskEdit] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  const [commentBody, setCommentBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const titleRef = React.useRef<HTMLTextAreaElement>(null);
  const detailRef = React.useRef<TaskDetail | null>(null);
  // Keep the live description separate from render state so blur/close always
  // saves the latest edit and older mutation responses cannot overwrite it.
  const descriptionRef = React.useRef("");
  const descriptionDirtyRef = React.useRef(false);
  const descriptionVersionRef = React.useRef(0);
  const loadTokenRef = React.useRef(0);
  const mutationQueueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const busyCountRef = React.useRef(0);

  const commitDetail = React.useCallback(
    (next: TaskDetail, notify = true) => {
      detailRef.current = next;
      setDetail(next);
      if (notify) onTaskUpdated(next);
    },
    [onTaskUpdated],
  );

  function beginBusy() {
    busyCountRef.current += 1;
    setBusy(true);
  }

  function endBusy() {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1);
    if (busyCountRef.current === 0) setBusy(false);
  }

  // Serialize mutations so a slow response can never overwrite a newer edit.
  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationQueueRef.current.then(operation, operation);
    mutationQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const loadTask = React.useCallback(
    async (id: string) => {
      const token = ++loadTokenRef.current;
      detailRef.current = null;
      setDetail(null);
      setDeleteOpen(false);
      setCommentBody("");
      setSubtaskTitle("");
      setSubtaskEdit(null);
      setLoading(true);
      setLoadError(null);
      try {
        const { task: full } = await api<{ task: TaskDetail }>(
          `/api/tasks/${id}`,
        );
        if (token !== loadTokenRef.current) return;
        detailRef.current = full;
        setDetail(full);
        setTitle(full.title);
        descriptionRef.current = full.description ?? "";
        descriptionDirtyRef.current = false;
        descriptionVersionRef.current += 1;
        setDescription(full.description ?? "");
      } catch (error) {
        if (token === loadTokenRef.current) setLoadError(errorMessage(error));
      } finally {
        if (token === loadTokenRef.current) setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!open || !taskId) return;
    const timeout = window.setTimeout(() => void loadTask(taskId), 0);
    return () => window.clearTimeout(timeout);
  }, [open, taskId, loadTask]);

  React.useEffect(() => {
    if (!titleRef.current) return;
    titleRef.current.style.height = "auto";
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
  }, [title, detail?.id]);

  async function updateTaskNow(
    input: Record<string, unknown>,
  ): Promise<TaskDetail | null> {
    const current = detailRef.current;
    if (!current) return null;
    const targetId = current.id;
    const { task: updated } = await api<{ task: TaskDetail }>(
      `/api/tasks/${targetId}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    if (detailRef.current?.id !== targetId) return null;
    const hasUnsavedDescription = descriptionDirtyRef.current;
    commitDetail(updated);
    setTitle(updated.title);
    if (!hasUnsavedDescription) {
      descriptionRef.current = updated.description ?? "";
      setDescription(updated.description ?? "");
    }
    return updated;
  }

  async function patchTask(
    input: Record<string, unknown>,
    successMessage?: string,
  ): Promise<TaskDetail | null> {
    if (!detailRef.current) return null;
    beginBusy();
    try {
      const updated = await enqueueMutation(() => updateTaskNow(input));
      if (updated && successMessage) toast.success(successMessage);
      return updated;
    } catch (error) {
      toast.error("Could not update task", {
        description: errorMessage(error),
      });
      return null;
    } finally {
      endBusy();
    }
  }

  async function saveTitle() {
    const current = detailRef.current;
    if (!current || readOnly) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(current.title);
      return;
    }
    if (trimmed === current.title) return;
    await patchTask({ title: trimmed });
  }

  async function saveDescription() {
    const current = detailRef.current;
    if (!current || readOnly) return;
    const trimmed = descriptionRef.current.trim();
    const next = trimmed || null;
    if (next === current.description) {
      descriptionDirtyRef.current = false;
      return;
    }
    const version = descriptionVersionRef.current;
    const updated = await patchTask({ description: next });
    if (!updated || descriptionVersionRef.current !== version) return;
    descriptionDirtyRef.current = false;
    descriptionRef.current = updated.description ?? "";
    setDescription(updated.description ?? "");
  }

  async function changeColumn(columnId: string) {
    const current = detailRef.current;
    if (!current || columnId === current.columnId) return;
    const column = columns.find((item) => item.id === columnId);
    await patchTask(
      { columnId },
      column ? `Moved to ${column.name}` : "Task moved",
    );
  }

  async function toggleLabel(label: BoardLabel) {
    const current = detailRef.current;
    if (!current) return;
    const has = current.labelIds.includes(label.id);
    await patchTask({
      labelIds: has
        ? current.labelIds.filter((id) => id !== label.id)
        : [...current.labelIds, label.id],
    });
  }

  async function createLabelForTask(draft: LabelDraft) {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const created = await createLabel(current.boardId, draft);
        onLabelCreated(created);
        const latest = detailRef.current;
        if (latest?.id === current.id) {
          await updateTaskNow({
            labelIds: [...latest.labelIds, created.id],
          });
        }
      });
    } finally {
      endBusy();
    }
  }

  async function addSubtask(event: React.FormEvent) {
    event.preventDefault();
    const title = subtaskTitle.trim();
    const current = detailRef.current;
    if (!current || !title) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        if (!active || active.id !== current.id) return;
        const { subtask } = await api<{ subtask: Subtask }>(
          `/api/tasks/${active.id}/subtasks`,
          {
            method: "POST",
            body: JSON.stringify({ title }),
          },
        );
        const latest = detailRef.current;
        if (!latest || latest.id !== current.id) return;
        const nextSubtasks = [...latest.subtasks, subtask];
        commitDetail({
          ...latest,
          subtasks: nextSubtasks,
          subtaskCount: nextSubtasks.length,
          subtaskDoneCount: nextSubtasks.filter((item) => item.completed)
            .length,
        });
        setSubtaskTitle("");
      });
    } catch (error) {
      toast.error("Could not add subtask", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  function startEditingSubtask(subtask: Subtask) {
    setSubtaskEdit({ id: subtask.id, title: subtask.title });
  }

  function stopEditingSubtask(subtaskId: string) {
    setSubtaskEdit((current) =>
      current?.id === subtaskId ? null : current,
    );
  }

  async function saveSubtaskTitle(
    subtask: Subtask,
    editing = subtaskEdit,
  ) {
    if (!editing || editing.id !== subtask.id) return;
    const trimmed = editing.title.trim();
    if (!trimmed || trimmed === subtask.title) {
      stopEditingSubtask(subtask.id);
      return;
    }
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        if (!active) return;
        const { subtask: updated } = await api<{ subtask: Subtask }>(
          `/api/subtasks/${subtask.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ title: trimmed }),
          },
        );
        const latest = detailRef.current;
        if (!latest || latest.id !== active.id) return;
        const nextSubtasks = latest.subtasks.map((item) =>
          item.id === updated.id ? updated : item,
        );
        commitDetail({
          ...latest,
          subtasks: nextSubtasks,
          subtaskCount: nextSubtasks.length,
          subtaskDoneCount: nextSubtasks.filter((item) => item.completed)
            .length,
        });
      });
      stopEditingSubtask(subtask.id);
    } catch (error) {
      toast.error("Could not update subtask", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  function flushPendingSubtaskEdit() {
    if (!subtaskEdit) return;
    const subtask = detailRef.current?.subtasks.find(
      (item) => item.id === subtaskEdit.id,
    );
    if (subtask) void saveSubtaskTitle(subtask, subtaskEdit);
  }

  function closeSheet() {
    if (!readOnly) {
      void saveDescription();
      flushPendingSubtaskEdit();
    }
    onOpenChange(false);
  }

  async function toggleSubtask(subtask: Subtask) {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        const target = active?.subtasks.find((item) => item.id === subtask.id);
        if (!active || !target) return;
        const { subtask: updated } = await api<{ subtask: Subtask }>(
          `/api/subtasks/${target.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ completed: !target.completed }),
          },
        );
        const latest = detailRef.current;
        if (!latest || latest.id !== active.id) return;
        const nextSubtasks = latest.subtasks.map((item) =>
          item.id === updated.id ? updated : item,
        );
        commitDetail({
          ...latest,
          subtasks: nextSubtasks,
          subtaskCount: nextSubtasks.length,
          subtaskDoneCount: nextSubtasks.filter((item) => item.completed)
            .length,
        });
      });
    } catch (error) {
      toast.error("Could not update subtask", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  async function deleteSubtask(subtask: Subtask) {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        if (!active || !active.subtasks.some((item) => item.id === subtask.id))
          return;
        await api(`/api/subtasks/${subtask.id}`, { method: "DELETE" });
        const latest = detailRef.current;
        if (!latest || latest.id !== active.id) return;
        const nextSubtasks = latest.subtasks.filter(
          (item) => item.id !== subtask.id,
        );
        commitDetail({
          ...latest,
          subtasks: nextSubtasks,
          subtaskCount: nextSubtasks.length,
          subtaskDoneCount: nextSubtasks.filter((item) => item.completed)
            .length,
        });
      });
    } catch (error) {
      toast.error("Could not delete subtask", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    const body = commentBody.trim();
    const current = detailRef.current;
    if (!current || !body) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        if (!active || active.id !== current.id) return;
        const { comment } = await api<{ comment: Comment }>(
          `/api/tasks/${active.id}/comments`,
          {
            method: "POST",
            body: JSON.stringify({ body }),
          },
        );
        const latest = detailRef.current;
        if (!latest || latest.id !== current.id) return;
        const nextComments = latest.comments.some(
          (item) => item.id === comment.id,
        )
          ? latest.comments
          : [...latest.comments, comment];
        commitDetail({
          ...latest,
          comments: nextComments,
          commentCount: nextComments.length,
        });
        setCommentBody("");
      });
    } catch (error) {
      toast.error("Could not add comment", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  async function deleteComment(comment: Comment) {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        const active = detailRef.current;
        if (!active || !active.comments.some((item) => item.id === comment.id))
          return;
        await api(`/api/comments/${comment.id}`, { method: "DELETE" });
        const latest = detailRef.current;
        if (!latest || latest.id !== active.id) return;
        const nextComments = latest.comments.filter(
          (item) => item.id !== comment.id,
        );
        commitDetail({
          ...latest,
          comments: nextComments,
          commentCount: nextComments.length,
        });
      });
    } catch (error) {
      toast.error("Could not delete comment", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  async function duplicate() {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      const copy = await enqueueMutation(async () => {
        const { task: created } = await api<{ task: TaskDetail }>(
          `/api/tasks/${current.id}/duplicate`,
          { method: "POST" },
        );
        return created;
      });
      onTaskDuplicated(copy);
      toast.success("Task duplicated", {
        description: copy.title,
      });
    } catch (error) {
      toast.error("Could not duplicate task", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  async function deleteTask() {
    const current = detailRef.current;
    if (!current) return;
    beginBusy();
    try {
      await enqueueMutation(async () => {
        await api(`/api/tasks/${current.id}`, { method: "DELETE" });
      });
      onTaskDeleted(current.id);
      setDeleteOpen(false);
      onOpenChange(false);
      toast.success("Task deleted");
    } catch (error) {
      toast.error("Could not delete task", {
        description: errorMessage(error),
      });
    } finally {
      endBusy();
    }
  }

  const column = detail
    ? columns.find((item) => item.id === detail.columnId)
    : task
      ? columns.find((item) => item.id === task.columnId)
      : undefined;
  const doneSubtasks = detail?.subtasks.filter((item) => item.completed).length ?? 0;
  const subtaskTotal = detail?.subtasks.length ?? 0;
  const subtaskPercent =
    subtaskTotal > 0 ? Math.round((doneSubtasks / subtaskTotal) * 100) : 0;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSheet();
            return;
          }
          onOpenChange(nextOpen);
        }}
      >
        <SheetContent
          side="right"
          className="gap-0 p-0"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (!subtaskEdit) return;
            event.preventDefault();
            stopEditingSubtask(subtaskEdit.id);
          }}
        >
          <SheetTitle className="sr-only">Task details</SheetTitle>
          <SheetDescription className="sr-only">
            Edit task properties, subtasks, labels, and comments.
          </SheetDescription>

          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-4">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
              <span className="truncate">{column?.name ?? "Task"}</span>
              <ChevronRight className="size-3 shrink-0 opacity-40" />
              <span className="truncate text-muted-foreground">Details</span>
            </span>
            <div className="ml-auto flex items-center gap-1">
              {!readOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Task actions"
                      disabled={!detail || busy}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void duplicate()}>
                      <Copy />
                      Duplicate task
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Trash2 />
                      Delete task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closeSheet}
                aria-label="Close task details"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {loading && (!detail || detail.id !== taskId) ? (
            <div className="space-y-5 p-6">
              <div className="h-7 w-3/4 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-12 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            </div>
          ) : loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <Circle className="size-7 text-muted-foreground" />
              <p className="text-[13px] font-medium">Task could not be loaded</p>
              <p className="max-w-xs text-[12px] text-muted-foreground">
                {loadError}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => taskId && void loadTask(taskId)}
                >
                  Try again
                </Button>
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          ) : detail && detail.id === taskId ? (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              <div className="px-5 pt-5 pb-8 sm:px-6">
                <div className="flex items-start gap-2">
                  <textarea
                    ref={titleRef}
                    value={title}
                    readOnly={readOnly}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => void saveTitle()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    rows={1}
                    maxLength={200}
                    aria-label="Task title"
                    className="font-display w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-0 py-0 text-[21px] leading-tight font-semibold text-foreground outline-none transition-colors hover:border-border/50 hover:bg-muted/20 focus:border-ring focus:bg-muted/20 focus:ring-2 focus:ring-ring"
                  />
                  {busy && (
                    <Loader2 className="mt-1.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </div>
                {readOnly && (
                  <p className="mt-3 rounded-lg border border-border/60 bg-muted/35 px-3 py-2 text-[11.5px] text-muted-foreground">
                    Archived project — this task is read-only. Restore the
                    project to make changes.
                  </p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
                  <span>Created {formatDateTime(detail.createdAt)}</span>
                  {detail.completedAt && (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="size-3" />
                      Completed
                    </span>
                  )}
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <MetaField label="Status">
                    <Select
                      value={detail.columnId}
                      onValueChange={(value) => void changeColumn(value)}
                      disabled={readOnly}
                    >
                      <SelectTrigger className="h-8 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </MetaField>
                  <MetaField label="Priority">
                    <PrioritySelect
                      value={detail.priority as Priority}
                      disabled={readOnly}
                      onChange={(priority) =>
                        void patchTask({ priority })
                      }
                    />
                  </MetaField>
                  <MetaField label="Due date" className="sm:col-span-2">
                    <div className="flex items-center gap-1">
                      <div className="relative flex-1">
                        <CalendarDays className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="date"
                          value={detail.dueDate ?? ""}
                          disabled={readOnly}
                          onChange={(event) =>
                            void patchTask({
                              dueDate: event.target.value || null,
                            })
                          }
                          className="h-8 pl-8 text-[12px]"
                          aria-label="Due date"
                        />
                      </div>
                      {detail.dueDate && !readOnly && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void patchTask({ dueDate: null })}
                          aria-label="Clear due date"
                          className="text-muted-foreground"
                        >
                          <X className="size-3" />
                        </Button>
                      )}
                    </div>
                  </MetaField>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      Labels
                    </h3>
                    {!readOnly && (
                      <LabelManagerPopover
                        labels={labels}
                        selectedIds={detail.labelIds}
                        onToggle={(label) => void toggleLabel(label)}
                        onCreate={createLabelForTask}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {detail.labelIds.length === 0 && (
                      <span className="text-[11.5px] text-muted-foreground">
                        No labels yet.
                      </span>
                    )}
                    {detail.labelIds.map((id) => {
                      const label = labels.find((item) => item.id === id);
                      if (!label) return null;
                      if (readOnly) {
                        return <LabelChip key={id} label={label} />;
                      }
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => void toggleLabel(label)}
                          className="group/label inline-flex items-center gap-1 rounded-full"
                          title={`Remove ${label.name}`}
                        >
                          <LabelChip label={label} />
                          <X className="size-2.5 text-muted-foreground/0 transition-colors group-hover/label:text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Description
                  </h3>
                  <textarea
                    value={description}
                    readOnly={readOnly}
                    onChange={(event) => {
                      descriptionRef.current = event.target.value;
                      descriptionDirtyRef.current = true;
                      descriptionVersionRef.current += 1;
                      setDescription(event.target.value);
                    }}
                    onBlur={() => void saveDescription()}
                    placeholder="Add context, links, or acceptance criteria…"
                    rows={4}
                    maxLength={5000}
                    className="mt-1.5 w-full resize-y rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground/90 outline-none transition-colors placeholder:text-muted-foreground hover:border-border/60 hover:bg-muted/20 focus:border-ring focus:bg-muted/20 focus:ring-2 focus:ring-ring"
                  />
                </div>

                <section className="mt-6 border-t border-border/60 pt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      Subtasks
                      {subtaskTotal > 0 && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tracking-normal text-muted-foreground">
                          {doneSubtasks}/{subtaskTotal}
                        </span>
                      )}
                    </h3>
                  </div>
                  {subtaskTotal > 0 && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            subtaskPercent === 100
                              ? "bg-success"
                              : "bg-primary/70",
                          )}
                          style={{ width: `${subtaskPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {subtaskPercent}%
                      </span>
                    </div>
                  )}
                  <ul className="mt-2.5 space-y-0.5">
                    {detail.subtasks.map((subtask) => {
                      const editing = subtaskEdit?.id === subtask.id;
                      return (
                        <li
                          key={subtask.id}
                          className="group/subtask flex items-start gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={subtask.completed}
                            disabled={readOnly}
                            onCheckedChange={() => void toggleSubtask(subtask)}
                            className="mt-0.5 size-3.5"
                            aria-label={`Subtask: ${subtask.title}`}
                          />
                          {editing && !readOnly ? (
                            <Input
                              autoFocus
                              value={subtaskEdit?.title ?? ""}
                              onChange={(event) =>
                                setSubtaskEdit((current) =>
                                  current?.id === subtask.id
                                    ? { ...current, title: event.target.value }
                                    : current,
                                )
                              }
                              onFocus={(event) => event.currentTarget.select()}
                              onBlur={() => void saveSubtaskTitle(subtask)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  stopEditingSubtask(subtask.id);
                                }
                              }}
                              maxLength={200}
                              aria-label={`Edit subtask ${subtask.title}`}
                              className="h-7 flex-1 text-[12.5px]"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditingSubtask(subtask)}
                              disabled={readOnly}
                              title={readOnly ? undefined : "Edit subtask"}
                              className={cn(
                                "min-w-0 flex-1 text-left text-[12.5px] leading-relaxed transition-colors hover:text-foreground disabled:hover:text-inherit",
                                subtask.completed &&
                                  "text-muted-foreground line-through",
                              )}
                            >
                              {subtask.title}
                            </button>
                          )}
                          {!editing && !readOnly && (
                            <button
                              type="button"
                              onClick={() => startEditingSubtask(subtask)}
                              className="mt-0.5 text-muted-foreground/0 transition-colors group-hover/subtask:text-muted-foreground hover:text-foreground focus-visible:text-muted-foreground"
                              aria-label={`Edit subtask ${subtask.title}`}
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => void deleteSubtask(subtask)}
                              className="mt-0.5 text-muted-foreground/0 transition-colors group-hover/subtask:text-muted-foreground hover:text-destructive"
                              aria-label={`Delete subtask ${subtask.title}`}
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {!readOnly && (
                    <form onSubmit={addSubtask} className="mt-2 flex items-center gap-1.5">
                      <Input
                        value={subtaskTitle}
                        onChange={(event) => setSubtaskTitle(event.target.value)}
                        placeholder="Add a subtask…"
                        maxLength={200}
                        className="h-8 text-[12px]"
                        disabled={busy}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="icon-sm"
                        disabled={!subtaskTitle.trim() || busy}
                        aria-label="Add subtask"
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </form>
                  )}
                </section>

                <section className="mt-6 border-t border-border/60 pt-5">
                  <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Comments
                    {detail.comments.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tracking-normal text-muted-foreground">
                        {detail.comments.length}
                      </span>
                    )}
                  </h3>
                  {detail.comments.length === 0 ? (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      No comments yet. Start the conversation.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-4">
                      {detail.comments.map((comment) => (
                        <li key={comment.id} className="group/comment flex gap-2.5">
                          <AuthorAvatar name={comment.author} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11.5px] font-medium">
                                {comment.author}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatRelative(comment.createdAt)}
                              </span>
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => void deleteComment(comment)}
                                  className="ml-auto text-muted-foreground/0 transition-colors group-hover/comment:text-muted-foreground hover:text-destructive"
                                  aria-label="Delete comment"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </div>
                            <p className="mt-1 rounded-lg rounded-tl-sm bg-muted/45 px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                              {comment.body}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!readOnly && (
                    <form onSubmit={addComment} className="mt-3">
                      <Textarea
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        placeholder="Leave a comment…"
                        rows={2}
                        maxLength={2000}
                        className="min-h-[64px] text-[12px]"
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <MessageSquare className="size-3" />
                          ⌘↵ to comment
                        </span>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={!commentBody.trim() || busy}
                          className="h-7 text-[11.5px]"
                        >
                          {busy && <Loader2 className="size-3 animate-spin" />}
                          Comment
                        </Button>
                      </div>
                    </form>
                  )}
                </section>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this task?"
        description={
          <>
            <span className="font-medium text-foreground">{detail?.title}</span>{" "}
            and its subtasks and comments will be permanently removed.
          </>
        }
        confirmLabel="Delete task"
        onConfirm={deleteTask}
        loading={busy}
      />
    </>
  );
}

function MetaField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </Label>
      {children}
    </div>
  );
}
