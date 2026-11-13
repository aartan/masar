import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Pencil,
  PenLine,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { CreateBoardDialog } from "@/components/board/create-board-dialog";
import { PageSurface } from "@/components/layout/page-surface";
import { RenameProjectDialog } from "@/components/project/project-dialogs";
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  FolderSettingsDialog,
} from "@/components/project/folder-dialogs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/dates";
import {
  buildProjectHierarchy,
  type FolderTreeNode,
} from "@/lib/folder-tree";
import type {
  BoardSummary,
  FolderSummary,
  ProjectDetail,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_ICON = { kanban: LayoutGrid, whiteboard: PenLine, note: FileText } as const;

export function ProjectView({
  initialData,
  onChanged,
}: {
  initialData: ProjectDetail;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [createBoard, setCreateBoard] = React.useState<{
    open: boolean;
    folderId: string | null;
  }>({ open: false, folderId: null });
  const [createFolderIn, setCreateFolderIn] = React.useState<{
    parentId: string | null;
    parentName?: string;
  } | null>(null);
  const [folderSettings, setFolderSettings] =
    React.useState<FolderSummary | null>(null);
  const [deleteFolder, setDeleteFolder] = React.useState<FolderSummary | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const project = initialData.project;
  const boards = initialData.boards;
  const folders = initialData.folders;
  const totals = initialData.totals;
  const hierarchy = React.useMemo(
    () => buildProjectHierarchy(project.id, folders, boards),
    [boards, folders, project.id],
  );
  const completion =
    totals.tasks > 0 ? Math.round((totals.done / totals.tasks) * 100) : 0;

  function openCreateFolder(
    parentId: string | null,
    parentName?: string,
  ) {
    setCreateFolderIn({ parentId, parentName });
  }

  async function handleArchiveToggle() {
    try {
      await api(
        `/api/projects/${project.id}/${project.archived ? "restore" : "archive"}`,
        { method: "POST" },
      );
      onChanged?.();
      toast.success(project.archived ? "Project restored" : "Project archived");
    } catch (error) {
      toast.error("Could not update project", { description: errorMessage(error) });
    }
  }

  return (
    <PageSurface scroll>
      <div className="mx-auto w-full max-w-[1220px] px-5 py-8">
        <header className="animate-rise">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Project
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold">{project.name}</h1>
              {project.archived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Archive className="size-3" />
                  Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!project.archived && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Pencil className="size-4" />
                  Project settings
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleArchiveToggle}>
                {project.archived ? (
                  <>
                    <ArchiveRestore className="size-4" />
                    Restore
                  </>
                ) : (
                  <>
                    <Archive className="size-4" />
                    Archive
                  </>
                )}
              </Button>
              {!project.archived && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openCreateFolder(null)}
                >
                  <FolderPlus className="size-4" />
                  New folder
                </Button>
              )}
              {!project.archived && (
                <Button size="sm" onClick={() => setCreateBoard({ open: true, folderId: null })}>
                  <Plus className="size-4" />
                  New space
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {project.description || "No description yet."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <LayoutGrid className="size-3.5" />
              {project.kanbanCount} Kanban
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="size-3.5" />
              {project.whiteboardCount} Whiteboard
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="size-3.5" />
              {project.noteCount} Note
            </span>
            <span>
              {totals.tasks} task{totals.tasks === 1 ? "" : "s"}
            </span>
            {totals.totalEffort > 0 && (
              <span>
                Total Effort: {totals.totalEffort}
              </span>
            )}
            <span>{completion}% complete</span>
            {totals.overdue > 0 && (
              <span className="text-destructive">
                {totals.overdue} overdue
              </span>
            )}
          </div>
        </header>

        <section className="mt-7 space-y-4">
          {hierarchy.folders.map((node) => (
            <FolderSection
              key={node.folder.id}
              node={node}
              archived={project.archived}
              onOpenBoard={(boardId) => navigate(`/boards/${boardId}`)}
              onCreateSpace={(folderId) =>
                setCreateBoard({ open: true, folderId })
              }
              onCreateFolder={openCreateFolder}
              onSettings={setFolderSettings}
              onDelete={setDeleteFolder}
            />
          ))}

          {hierarchy.boards.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hierarchy.boards.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  onOpen={() => navigate(`/boards/${board.id}`)}
                />
              ))}
            </div>
          )}

          {hierarchy.folders.length === 0 &&
            hierarchy.boards.length === 0 && (
              <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-14 text-center">
                <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Plus className="size-5" />
                </span>
                <div>
                  <p className="text-[14px] font-medium">
                    No spaces in this project yet
                  </p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Add a Kanban space, a whiteboard or a note, or organise them
                    in folders.
                  </p>
                </div>
                {!project.archived && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        setCreateBoard({ open: true, folderId: null })
                      }
                    >
                      <Plus className="size-4" />
                      New space
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openCreateFolder(null)}
                    >
                      <FolderPlus className="size-4" />
                      New folder
                    </Button>
                  </div>
                )}
              </Card>
            )}
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card className="animate-rise">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <CalendarDays className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[13px] font-semibold">Upcoming</p>
                <p className="text-[11px] text-muted-foreground">
                  Open tasks with due dates in this project.
                </p>
              </div>
            </div>
            <div className="p-4">
              {initialData.upcoming.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">
                  Nothing due soon.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {initialData.upcoming.map((task) => (
                    <li key={task.id}>
                      <Link
                        to={`/boards/${task.boardId}?task=${task.id}`}
                        className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium">
                            {task.title}
                          </span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">
                            {task.boardName} / {task.columnName}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">
                          {task.dueDate}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card className="animate-rise">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <CheckCircle2 className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[13px] font-semibold">Recent activity</p>
                <p className="text-[11px] text-muted-foreground">
                  Task, whiteboard, and note updates in this project.
                </p>
              </div>
            </div>
            <div className="p-4">
              {initialData.activity.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">
                  No activity yet.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {initialData.activity.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      <Link
                        to={
                          item.kind === "task"
                            ? `/boards/${item.boardId}?task=${item.id.slice("task:".length)}`
                            : `/boards/${item.boardId}`
                        }
                        className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
                      >
                        {item.boardType === "whiteboard" ? (
                          <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : item.boardType === "note" ? (
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <LayoutGrid className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px]">
                            {item.title}
                          </span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">
                            {item.boardName}
                            {item.detail ? ` · ${item.detail}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatDateTime(item.timestamp)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      <CreateBoardDialog
        open={createBoard.open}
        projectId={project.id}
        folderId={createBoard.folderId}
        onOpenChange={(open) => setCreateBoard((state) => ({ ...state, open }))}
        onCreated={() => onChanged?.()}
      />
      {createFolderIn && (
        <CreateFolderDialog
          open
          projectId={project.id}
          parentId={createFolderIn.parentId}
          parentName={createFolderIn.parentName}
          onOpenChange={(open) => !open && setCreateFolderIn(null)}
          onDone={() => onChanged?.()}
        />
      )}
      <FolderSettingsDialog
        folder={folderSettings}
        folders={folders}
        open={folderSettings !== null}
        onOpenChange={(open) => !open && setFolderSettings(null)}
        onDone={() => onChanged?.()}
      />
      <DeleteFolderDialog
        folder={deleteFolder}
        folders={folders}
        open={deleteFolder !== null}
        onOpenChange={(open) => !open && setDeleteFolder(null)}
        onDeleted={() => onChanged?.()}
      />
      <RenameProjectDialog
        project={project}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onDone={() => onChanged?.()}
      />
      <ProjectBackLink />
    </PageSurface>
  );
}

function countFolderSpaces(node: FolderTreeNode): number {
  return (
    node.boards.length +
    node.folders.reduce((total, child) => total + countFolderSpaces(child), 0)
  );
}

function BoardCard({
  board,
  onOpen,
}: {
  board: BoardSummary;
  onOpen: () => void;
}) {
  const Icon = TYPE_ICON[board.type] ?? LayoutGrid;
  const pct =
    board.taskCount > 0
      ? Math.round((board.doneCount / board.taskCount) * 100)
      : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group animate-rise rounded-xl border border-border/70 bg-card p-4 text-left transition-colors hover:border-border hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="truncate text-[14px] font-medium">{board.name}</span>
      </div>
      {board.type === "kanban" ? (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {board.doneCount}/{board.taskCount} done · {board.columnCount}{" "}
            columns
          </p>
        </>
      ) : (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          {board.type === "note" ? "Note" : "Whiteboard canvas"}
        </p>
      )}
    </button>
  );
}

function FolderSection({
  node,
  archived,
  onOpenBoard,
  onCreateSpace,
  onCreateFolder,
  onSettings,
  onDelete,
}: {
  node: FolderTreeNode;
  archived: boolean;
  onOpenBoard: (boardId: string) => void;
  onCreateSpace: (folderId: string) => void;
  onCreateFolder: (parentId: string | null, parentName?: string) => void;
  onSettings: (folder: FolderSummary) => void;
  onDelete: (folder: FolderSummary) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const folder = node.folder;
  const spaceCount = countFolderSpaces(node);
  const childCount = node.folders.length + node.boards.length;

  return (
    <div className="animate-rise rounded-xl border border-border/70 bg-card/60 p-3 sm:p-4">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[13.5px] font-semibold">
            {folder.name}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {node.folders.length} folder{node.folders.length === 1 ? "" : "s"} ·{" "}
            {spaceCount} space{spaceCount === 1 ? "" : "s"}
          </span>
        </button>
        {!archived && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onCreateSpace(folder.id)}
              aria-label={`Add space to ${folder.name}`}
            >
              <Plus className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Folder actions for ${folder.name}`}
                >
                  <Settings2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[190px]">
                <DropdownMenuItem onClick={() => onCreateSpace(folder.id)}>
                  <Plus />
                  New space
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCreateFolder(folder.id, folder.name)}
                >
                  <FolderPlus />
                  New subfolder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onSettings(folder)}>
                  <Pencil />
                  Rename or move
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(folder)}
                  className="text-destructive"
                >
                  <Trash2 />
                  Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-l border-border/60 pl-3">
          {node.folders.map((child) => (
            <FolderSection
              key={child.folder.id}
              node={child}
              archived={archived}
              onOpenBoard={onOpenBoard}
              onCreateSpace={onCreateSpace}
              onCreateFolder={onCreateFolder}
              onSettings={onSettings}
              onDelete={onDelete}
            />
          ))}

          {node.boards.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {node.boards.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  onOpen={() => onOpenBoard(board.id)}
                />
              ))}
            </div>
          )}

          {childCount === 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-[11.5px] text-muted-foreground">
              <span>This folder is empty.</span>
              {!archived && (
                <button
                  type="button"
                  onClick={() => onCreateSpace(folder.id)}
                  className="font-medium text-primary hover:underline"
                >
                  Add a space
                </button>
              )}
              {!archived && (
                <button
                  type="button"
                  onClick={() => onCreateFolder(folder.id, folder.name)}
                  className="font-medium text-primary hover:underline"
                >
                  Add a subfolder
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectBackLink() {
  return (
    <div className="mx-auto w-full max-w-[1220px] px-5 pb-10">
      <Link
        to="/"
        className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Back to overview
      </Link>
    </div>
  );
}
