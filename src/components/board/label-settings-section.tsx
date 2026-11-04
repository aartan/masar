"use client";

import * as React from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LabelManagerPopover } from "@/components/shared/label-manager-popover";
import { LabelChip } from "@/components/shared/task-meta";
import { errorMessage } from "@/lib/client-api";
import {
  createLabel,
  deleteLabel,
  updateLabel,
  type LabelDraft,
} from "@/lib/labels";
import type { Label as BoardLabel } from "@/lib/types";

export function LabelSettingsSection({
  boardId,
  labels,
  onCreated,
  onUpdated,
  onDeleted,
}: {
  boardId: string;
  labels: BoardLabel[];
  onCreated: (label: BoardLabel) => void;
  onUpdated: (label: BoardLabel) => void;
  onDeleted: (labelId: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = React.useState<BoardLabel | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  async function handleCreate(draft: LabelDraft) {
    const label = await createLabel(boardId, draft);
    onCreated(label);
  }

  async function handleUpdate(label: BoardLabel, draft: LabelDraft) {
    const updated = await updateLabel(label.id, draft);
    onUpdated(updated);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await deleteLabel(target.id);
      onDeleted(target.id);
      setDeleteTarget(null);
      toast.success("Label deleted", { description: target.name });
    } catch (error) {
      toast.error("Could not delete label", {
        description: errorMessage(error),
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="border-t border-border/60 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground/60 uppercase">
          Labels
        </h3>
        <LabelManagerPopover
          labels={labels}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={setDeleteTarget}
          modal
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {labels.length === 0 ? (
          <span className="text-[11.5px] text-muted-foreground/60">
            No labels yet.
          </span>
        ) : (
          labels.map((label) => <LabelChip key={label.id} label={label} />)
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "label"}?`}
        description={
          <>
            <span className="font-medium text-foreground">
              {deleteTarget?.name}
            </span>{" "}
            will be removed from this board and from every task that uses it.
            The tasks themselves will not be deleted.
          </>
        }
        confirmLabel="Delete label"
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </section>
  );
}
