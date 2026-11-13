"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage } from "@/lib/client-api";
import { folderPathLabel, folderSubtreeIds } from "@/lib/folder-tree";
import type { FolderSummary } from "@/lib/types";

const ROOT_VALUE = "__root__";

export function CreateFolderDialog({
  open,
  onOpenChange,
  projectId,
  parentId,
  parentName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  parentId: string | null;
  /** Display name of the parent folder, used in the dialog copy. */
  parentName?: string;
  onDone?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      await api("/api/folders", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          parentId,
          name: name.trim(),
        }),
      });
      onOpenChange(false);
      onDone?.();
      toast.success("Folder created");
    } catch (error) {
      toast.error("Could not create folder", {
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
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            {parentId && parentName
              ? `Create a folder inside ${parentName}. Folders can hold spaces and more folders.`
              : "Group spaces inside this project. You can add subfolders later."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Marketing"
              maxLength={80}
              required
              disabled={loading}
              autoFocus
            />
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
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FolderSettingsDialog({
  folder,
  folders,
  open,
  onOpenChange,
  onDone,
}: {
  folder: FolderSummary | null;
  folders: FolderSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [destination, setDestination] = React.useState(ROOT_VALUE);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setDestination(folder.parentId ?? ROOT_VALUE);
    }
  }, [open, folder]);

  const destinations = React.useMemo(() => {
    if (!folder) return [];
    const blocked = folderSubtreeIds(folders, folder.id);
    return folders
      .filter(
        (item) =>
          item.projectId === folder.projectId &&
          !blocked.has(item.id),
      )
      .map((item) => ({ item, label: folderPathLabel(folders, item.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folder, folders]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!folder || !name.trim() || loading) return;
    setLoading(true);
    try {
      if (name.trim() !== folder.name) {
        await api(`/api/folders/${folder.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim() }),
        });
      }
      const parentId = destination === ROOT_VALUE ? null : destination;
      if (parentId !== folder.parentId) {
        await api(`/api/folders/${folder.id}/move`, {
          method: "POST",
          body: JSON.stringify({ parentId, index: 100000 }),
        });
      }
      onOpenChange(false);
      onDone?.();
      toast.success("Folder updated");
    } catch (error) {
      toast.error("Could not update folder", {
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
          <DialogTitle>Folder settings</DialogTitle>
          <DialogDescription>
            Rename this folder or move it, with everything inside, to another
            location in the project.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="folder-settings-name">Name</Label>
            <Input
              id="folder-settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="folder-settings-location">Location</Label>
            <Select
              value={destination}
              onValueChange={setDestination}
              disabled={loading}
            >
              <SelectTrigger id="folder-settings-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>Project root</SelectItem>
                {destinations.map(({ item, label }) => (
                  <SelectItem key={item.id} value={item.id}>
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
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFolderDialog({
  folder,
  folders,
  open,
  onOpenChange,
  onDeleted,
}: {
  folder: FolderSummary | null;
  folders: FolderSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const parentLabel = folder?.parentId
    ? folderPathLabel(folders, folder.parentId)
    : "the project root";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!folder || loading) return;
    setLoading(true);
    try {
      await api(`/api/folders/${folder.id}`, { method: "DELETE" });
      onOpenChange(false);
      onDeleted?.();
      toast.success("Folder deleted", {
        description: "Its subfolders and spaces were moved up one level.",
      });
    } catch (error) {
      toast.error("Could not delete folder", {
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
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            Delete <strong>{folder?.name}</strong>? Spaces and subfolders inside
            it are kept and moved to {parentLabel}. No tasks are deleted.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Delete folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
