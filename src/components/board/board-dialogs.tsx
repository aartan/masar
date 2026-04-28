"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrioritySelect } from "@/components/shared/priority-select";
import { LabelChip } from "@/components/shared/task-meta";
import { api, errorMessage } from "@/lib/client-api";
import type { BoardColumn, Label as BoardLabel, Task } from "@/lib/types";
import type { Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function NewTaskDialog({
  open,
  onOpenChange,
  boardId,
  columns,
  labels,
  defaultColumnId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  columns: BoardColumn[];
  labels: BoardLabel[];
  defaultColumnId?: string;
  onCreated: (task: Task) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <NewTaskForm
          boardId={boardId}
          columns={columns}
          labels={labels}
          defaultColumnId={defaultColumnId}
          onCreated={onCreated}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewTaskForm({
  boardId,
  columns,
  labels,
  defaultColumnId,
  onCreated,
  onClose,
}: {
  boardId: string;
  columns: BoardColumn[];
  labels: BoardLabel[];
  defaultColumnId?: string;
  onCreated: (task: Task) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [columnId, setColumnId] = React.useState(
    defaultColumnId ?? columns[0]?.id ?? "",
  );
  const [priority, setPriority] = React.useState<Priority>("none");
  const [dueDate, setDueDate] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [labelIds, setLabelIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  function toggleLabel(id: string) {
    setLabelIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !columnId || loading) return;
    setLoading(true);
    try {
      const { task } = await api<{ task: Task }>(
        `/api/boards/${boardId}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            columnId,
            priority,
            dueDate: dueDate || null,
            assignee: assignee.trim() || null,
            labelIds,
          }),
        },
      );
      onCreated(task);
      onClose();
      toast.success("Task created", {
        description: "It has been added to the board.",
      });
    } catch (error) {
      toast.error("Could not create task", {
        description: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>
          Capture the work now. You can refine the details later.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-task-title">Title</Label>
          <Input
            id="new-task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
            maxLength={200}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-task-description">
            Description{" "}
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Textarea
            id="new-task-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context, links, or acceptance criteria…"
            rows={3}
            maxLength={5000}
            disabled={loading}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Column</Label>
            <Select
              value={columnId}
              onValueChange={setColumnId}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <PrioritySelect
              value={priority}
              onChange={setPriority}
              disabled={loading}
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-task-due">Due date</Label>
            <Input
              id="new-task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-task-assignee">Assignee</Label>
            <Input
              id="new-task-assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Name or initials"
              maxLength={80}
              disabled={loading}
            />
          </div>
        </div>
        {labels.length > 0 && (
          <div className="space-y-2">
            <Label>Labels</Label>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => {
                const selected = labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    className={cn(
                      "rounded-full border p-0.5 transition-all",
                      selected
                        ? "border-primary/50 bg-primary/8"
                        : "border-transparent opacity-60 hover:opacity-100",
                    )}
                    aria-pressed={selected}
                  >
                    <LabelChip label={label} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create task
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function ColumnFormDialog({
  open,
  onOpenChange,
  boardId,
  column,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  column?: BoardColumn | null;
  onSaved: (column: BoardColumn) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <ColumnForm
          key={column?.id ?? "new"}
          boardId={boardId}
          column={column}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ColumnForm({
  boardId,
  column,
  onSaved,
  onClose,
}: {
  boardId: string;
  column?: BoardColumn | null;
  onSaved: (column: BoardColumn) => void;
  onClose: () => void;
}) {
  const editing = Boolean(column);
  const [name, setName] = React.useState(column?.name ?? "");
  const [isDone, setIsDone] = React.useState(column?.isDone ?? false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      const endpoint = editing
        ? `/api/columns/${column?.id}`
        : `/api/boards/${boardId}/columns`;
      const { column: saved } = await api<{ column: BoardColumn }>(endpoint, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(
          editing
            ? { name: name.trim() }
            : { name: name.trim(), isDone },
        ),
      });
      onSaved(saved);
      onClose();
      toast.success(editing ? "Column renamed" : "Column created");
    } catch (error) {
      toast.error(
        editing ? "Could not rename column" : "Could not create column",
        { description: errorMessage(error) },
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Rename column" : "Add a column"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Give this stage of your workflow a clearer name."
            : "Shape the board around the way your work actually moves."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="column-name">Name</Label>
          <Input
            id="column-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Ready to ship"
            maxLength={60}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        {!editing && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={isDone}
              onCheckedChange={(checked) => setIsDone(checked === true)}
              disabled={loading}
              className="mt-0.5"
            />
            <span>
              <span className="block text-[12.5px] font-medium">
                Completion column
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                Tasks moved here count as completed. Only one column can be the
                completion column.
              </span>
            </span>
          </label>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save name" : "Add column"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onSaved,
  onRequestDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: { id: string; name: string; description: string | null };
  onSaved: (board: {
    id: string;
    name: string;
    description: string | null;
  }) => void;
  onRequestDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BoardSettingsForm
          board={board}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onRequestDelete={onRequestDelete}
        />
      </DialogContent>
    </Dialog>
  );
}

function BoardSettingsForm({
  board,
  onSaved,
  onClose,
  onRequestDelete,
}: {
  board: { id: string; name: string; description: string | null };
  onSaved: (board: {
    id: string;
    name: string;
    description: string | null;
  }) => void;
  onClose: () => void;
  onRequestDelete: () => void;
}) {
  const [name, setName] = React.useState(board.name);
  const [description, setDescription] = React.useState(
    board.description ?? "",
  );
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      const { board: saved } = await api<{
        board: { id: string; name: string; description: string | null };
      }>(`/api/boards/${board.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      onSaved(saved);
      onClose();
      toast.success("Board updated");
    } catch (error) {
      toast.error("Could not update board", {
        description: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Board settings</DialogTitle>
        <DialogDescription>
          Rename your board or adjust the context your team sees.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="board-settings-name">Name</Label>
          <Input
            id="board-settings-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="board-settings-description">Description</Label>
          <Textarea
            id="board-settings-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={400}
            rows={3}
            disabled={loading}
          />
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3.5 py-3">
          <p className="text-[12px] font-medium text-destructive">
            Delete this board
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Every column and task will be removed. This cannot be undone.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRequestDelete}
          >
            Delete board…
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
