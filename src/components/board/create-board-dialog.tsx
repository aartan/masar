"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus } from "lucide-react";
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
import { api, errorMessage } from "@/lib/client-api";
import { BOARD_COLORS, type BoardColor } from "@/lib/constants";
import type { BoardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";

export function CreateBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateBoardForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateBoardForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState<BoardColor>("sage");
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
        }),
      });
      onClose();
      toast.success("Board created", {
        description: `${board.name} is ready with five starter columns.`,
      });
      router.push(`/boards/${board.id}`);
      router.refresh();
    } catch (error) {
      toast.error("Could not create board", {
        description: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a board</DialogTitle>
        <DialogDescription>
          Boards hold your columns and tasks. You can rename or delete it later.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="board-name">Name</Label>
          <Input
            id="board-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Product launch"
            maxLength={80}
            required
            disabled={loading}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="board-description">
            Description{" "}
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Textarea
            id="board-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this board for?"
            maxLength={400}
            rows={2}
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label>Accent</Label>
          <div
            className="flex items-center gap-2"
            role="radiogroup"
            aria-label="Board accent"
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
            Create board
            <ArrowRight className="size-3.5 opacity-60" />
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
