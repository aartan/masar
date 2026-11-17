"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage } from "@/lib/client-api";
import { folderPathLabel } from "@/lib/folder-tree";
import type { BoardSummary } from "@/lib/types";

const ROOT_VALUE = "__root__";

export function MoveSpaceDialog({
  board,
  open,
  onOpenChange,
  onMoved,
}: {
  board: BoardSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: (destination: {
    projectId: string;
    folderId: string | null;
  }) => void;
}) {
  const { projects, folders } = useWorkspace();
  const [projectId, setProjectId] = React.useState("");
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const activeProjects = projects.filter((project) => !project.archived);

  React.useEffect(() => {
    if (!open || !board) return;
    const fallbackProject = projects.find((project) => !project.archived);
    setProjectId(board.projectId ?? fallbackProject?.id ?? "");
    setFolderId(board.folderId);
    setLoading(false);
    // Reset only when the dialog opens for a board. Workspace refreshes while
    // the dialog is open must not clobber the user's destination selection.
  }, [open, board]);

  const projectFolders = React.useMemo(
    () =>
      folders
        .filter((folder) => folder.projectId === projectId)
        .map((folder) => ({
          id: folder.id,
          label: folderPathLabel(folders, folder.id),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [folders, projectId],
  );

  function handleProjectChange(value: string) {
    setProjectId(value);
    setFolderId(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!board || !projectId || loading) return;
    if (
      projectId === (board.projectId ?? "") &&
      folderId === board.folderId
    ) {
      onOpenChange(false);
      return;
    }
    setLoading(true);
    try {
      await api(`/api/boards/${board.id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId, folderId }),
      });
      toast.success("Space moved");
      onOpenChange(false);
      onMoved?.({ projectId, folderId });
    } catch (error) {
      toast.error("Could not move space", {
        description: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move space</DialogTitle>
          <DialogDescription>
            Choose where <strong>{board?.name}</strong> should live. It will be
            placed at the end of the destination.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="move-space-project">Project</Label>
            <Select
              value={projectId}
              onValueChange={handleProjectChange}
              disabled={loading}
            >
              <SelectTrigger id="move-space-project" autoFocus>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {activeProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="move-space-folder">Folder</Label>
            <Select
              value={folderId ?? ROOT_VALUE}
              onValueChange={(value) =>
                setFolderId(value === ROOT_VALUE ? null : value)
              }
              disabled={loading || !projectId}
            >
              <SelectTrigger id="move-space-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>Project root</SelectItem>
                {projectFolders.map(({ id, label }) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!projectId || loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Move space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
