"use client";

import * as React from "react";
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { LabelColorPicker } from "@/components/shared/label-color-picker";
import { LABEL_COLOR_SWATCH } from "@/components/shared/colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { errorMessage } from "@/lib/client-api";
import type { LabelColor } from "@/lib/constants";
import type { LabelDraft } from "@/lib/labels";
import type { Label } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Shared label management popover. Task details pass `selectedIds`/`onToggle`
 * to select labels, while board settings pass `onUpdate`/`onDelete` to manage
 * them. Both modes share the same creation form.
 */
export function LabelManagerPopover({
  labels,
  selectedIds,
  onToggle,
  onCreate,
  onUpdate,
  onDelete,
  modal = false,
}: {
  labels: Label[];
  selectedIds?: string[];
  onToggle?: (label: Label) => void;
  onCreate: (draft: LabelDraft) => Promise<void>;
  onUpdate?: (label: Label, draft: LabelDraft) => Promise<void>;
  onDelete?: (label: Label) => void;
  modal?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<LabelColor>("sage");
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editColor, setEditColor] = React.useState<LabelColor>("sage");
  const [saving, setSaving] = React.useState(false);
  const selectable = Boolean(selectedIds && onToggle);

  function startEditing(label: Label) {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditName("");
    setEditColor("sage");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) cancelEditing();
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      await onCreate({ name: trimmed, color });
      setName("");
      toast.success("Label created", { description: trimmed });
    } catch (error) {
      toast.error("Could not create label", {
        description: errorMessage(error),
      });
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(label: Label) {
    const trimmed = editName.trim();
    if (!trimmed || saving || !onUpdate) return;
    if (trimmed === label.name && editColor === label.color) {
      cancelEditing();
      return;
    }
    setSaving(true);
    try {
      await onUpdate(label, { name: trimmed, color: editColor });
      setEditingId(null);
      toast.success("Label updated", { description: trimmed });
    } catch (error) {
      toast.error("Could not update label", {
        description: errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded text-[10.5px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Tag className="size-3" />
          Manage
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="px-1 pb-1.5 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground/60 uppercase">
          Labels
        </p>
        {labels.length === 0 ? (
          <p className="px-1 py-2 text-[11.5px] text-muted-foreground">
            No labels yet. Create one below.
          </p>
        ) : (
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {labels.map((label) => {
              if (editingId === label.id) {
                return (
                  <div
                    key={label.id}
                    className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2"
                  >
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveEdit(label);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEditing();
                          }
                        }}
                        maxLength={40}
                        aria-label="Label name"
                        className="h-7 flex-1 text-[11.5px]"
                        disabled={saving}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6"
                        onClick={() => void saveEdit(label)}
                        disabled={!editName.trim() || saving}
                        aria-label="Save label"
                      >
                        {saving ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6"
                        onClick={cancelEditing}
                        disabled={saving}
                        aria-label="Cancel label edit"
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    <LabelColorPicker
                      value={editColor}
                      onChange={setEditColor}
                      disabled={saving}
                    />
                  </div>
                );
              }

              if (selectable) {
                const selected = selectedIds?.includes(label.id) ?? false;
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => onToggle?.(label)}
                    aria-pressed={selected}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] transition-colors hover:bg-accent/60"
                  >
                    <span
                      className={cn(
                        "grid size-4 place-items-center rounded border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {selected && (
                        <Check className="size-2.5" strokeWidth={3} />
                      )}
                    </span>
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        LABEL_COLOR_SWATCH[label.color],
                      )}
                    />
                    <span className="truncate">{label.name}</span>
                  </button>
                );
              }

              return (
                <div
                  key={label.id}
                  className="group/label flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] transition-colors hover:bg-accent/60"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      LABEL_COLOR_SWATCH[label.color],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                  <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/label:opacity-100 sm:group-focus-within/label:opacity-100">
                    {onUpdate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6"
                        onClick={() => startEditing(label)}
                        aria-label={`Edit label ${label.name}`}
                      >
                        <Pencil className="size-3" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 hover:text-destructive"
                        onClick={() => onDelete(label)}
                        aria-label={`Delete label ${label.name}`}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form
          onSubmit={handleCreate}
          className="mt-2 border-t border-border/70 pt-2"
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New label"
            maxLength={40}
            aria-label="New label name"
            className="h-7 text-[11.5px]"
            disabled={creating}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <LabelColorPicker
              value={color}
              onChange={setColor}
              disabled={creating}
            />
            <Button
              type="submit"
              size="xs"
              className="ml-auto h-6"
              disabled={!name.trim() || creating}
            >
              {creating ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Add
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
