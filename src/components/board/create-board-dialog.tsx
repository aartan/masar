"use client";

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, LayoutGrid, Loader2, Plus, PenLine } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/layout/workspace-provider";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/client-api";
import { BOARD_COLORS, type BoardColor, type BoardType } from "@/lib/constants";
import type { BoardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";

export function CreateBoardDialog({
  open,
  onOpenChange,
  onCreated,
  projectId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** Project the new board is created in; null falls back to the default. */
  projectId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateBoardForm
          key={open ? "open" : "closed"}
          projectId={projectId}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

const TYPE_OPTIONS: Array<{
  value: BoardType;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "kanban",
    label: "Kanban",
    hint: "Columns, tasks and due dates.",
    icon: LayoutGrid,
  },
  {
    value: "whiteboard",
    label: "Whiteboard",
    hint: "A free-form visual canvas.",
    icon: PenLine,
  },
  {
    value: "note",
    label: "Note",
    hint: "A rich-text document.",
    icon: FileText,
  },
];

function CreateBoardForm({
  onClose,
  onCreated,
  projectId,
}: {
  onClose: () => void;
  onCreated?: () => void;
  projectId: string | null;
}) {
  const navigate = useNavigate();
  const { projects } = useWorkspace();
  const activeProjects = React.useMemo(
    () =>
      [...projects]
        .filter((project) => !project.archived)
        .sort((a, b) => a.position - b.position),
    [projects],
  );
  const [type, setType] = React.useState<BoardType>("kanban");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState<BoardColor>("sage");
  const [selectedProjectId, setSelectedProjectId] = React.useState(
    projectId ?? activeProjects[0]?.id ?? "",
  );
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      const { board } = await api<{ board: BoardSummary }>("/api/boards", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          color,
          type,
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        }),
      });
      onClose();
      onCreated?.();
      toast.success("Space created", {
        description:
          board.type === "whiteboard"
            ? `${board.name} is ready to sketch on.`
            : board.type === "note"
              ? `${board.name} is ready to write in.`
              : `${board.name} is ready with five starter columns.`,
      });
      navigate(`/boards/${board.id}`);
    } catch (error) {
      toast.error("Could not create space", {
        description: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a space</DialogTitle>
        <DialogDescription>
          Choose a space type, then name it. The type can’t be changed later.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Space type"
        >
          {TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = type === option.value;
    return (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setType(option.value)}
        disabled={loading}
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
          selected
            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
            : "border-border hover:bg-accent/60",
        )}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Icon className="size-4 shrink-0 opacity-80" />
          {option.label}
        </span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          {option.hint}
        </span>
      </button>
    );
  })}
        </div>

        <div className="space-y-2">
          <Label>Project</Label>
          {activeProjects.length > 0 ? (
            <Select
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {activeProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[11.5px] text-muted-foreground">
              A General project will be created for this board.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="board-name">Space name</Label>
          <Input
            id="board-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              type === "whiteboard"
                ? "e.g. Brainstorm"
                : type === "note"
                  ? "e.g. Meeting notes"
                  : "e.g. Product launch"
            }
            maxLength={80}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        {type === "kanban" && (
          <div className="space-y-2">
            <Label htmlFor="board-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">optional</span>
            </Label>
            <Textarea
              id="board-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this space for?"
              maxLength={400}
              rows={2}
              disabled={loading}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Accent</Label>
          <div
            className="flex items-center gap-2"
            role="radiogroup"
            aria-label="Space accent"
          >
            {BOARD_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={color === item}
                aria-label={item}
                onClick={() => setColor(item)}
                className={cn(
                  "grid size-8 place-items-center rounded-full border transition-all",
                  color === item
                    ? "border-foreground/40 bg-accent shadow-sm"
                    : "border-transparent hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "size-3.5 rounded-full",
                    BOARD_COLOR_CLASS[item],
                    "board-dot",
                  )}
                />
              </button>
            ))}
          </div>
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
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create space
            <ArrowRight className="size-3.5 opacity-60" />
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
