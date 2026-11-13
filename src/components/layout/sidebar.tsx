import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenLine,
  Plus,
  Search,
  Settings2,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/brand/logo";
import { Kbd } from "@/components/shared/empty-state";
import { useTheme, type Theme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  CreateProjectDialog,
  DeleteProjectDialog,
  RenameProjectDialog,
} from "@/components/project/project-dialogs";
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  FolderSettingsDialog,
} from "@/components/project/folder-dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/client-api";
import {
  buildProjectHierarchy,
  folderSubtreeIds,
  type FolderTreeNode,
  type ProjectHierarchy,
} from "@/lib/folder-tree";
import { useSyncStatus } from "@/lib/use-sync-status";
import type {
  BoardSummary,
  FolderSummary,
  ProjectSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarContentProps {
  projects: ProjectSummary[];
  folders: FolderSummary[];
  boards: BoardSummary[];
  conflictCount: number;
  user: { name: string; email: string };
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSearch: () => void;
  onCreateBoard: (
    projectId: string | null,
    folderId?: string | null,
  ) => void;
  onOpenShortcuts: () => void;
  onReorderProjects: (projectIds: string[]) => Promise<void>;
  onMoveBoards: (
    projectId: string,
    folderId: string | null,
    boardIds: string[],
  ) => Promise<void>;
  onMoveFolder: (
    folderId: string,
    parentId: string | null,
    index: number,
  ) => Promise<void>;
  onRefresh: () => Promise<void> | void;
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}

interface DragData {
  type: "project" | "folder" | "board" | "container";
  projectId?: string;
  /** Folder id for a folder row, or the container of a board/container. */
  folderId?: string | null;
  /** Parent folder of a folder row, or null for a root-level row. */
  parentId?: string | null;
}

function byPosition(
  a: { position: number; createdAt: string },
  b: { position: number; createdAt: string },
): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

export function SidebarContent({
  projects,
  folders,
  boards,
  conflictCount,
  user,
  collapsed = false,
  onToggleCollapse,
  onOpenSearch,
  onCreateBoard,
  onOpenShortcuts,
  onReorderProjects,
  onMoveBoards,
  onMoveFolder,
  onRefresh,
  onNavigate,
  showClose,
  onClose,
}: SidebarContentProps) {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const sync = useSyncStatus();
  const initial = (user.name.trim()[0] ?? user.email[0] ?? "M").toUpperCase();
  const dndId = React.useId();

  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [renameProject, setRenameProject] = React.useState<ProjectSummary | null>(null);
  const [deleteProject, setDeleteProject] = React.useState<ProjectSummary | null>(null);
  const [collapsedProjects, setCollapsedProjects] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [createFolder, setCreateFolder] = React.useState<{
    projectId: string;
    parentId: string | null;
    parentName?: string;
  } | null>(null);
  const [folderSettings, setFolderSettings] =
    React.useState<FolderSummary | null>(null);
  const [deleteFolder, setDeleteFolder] = React.useState<FolderSummary | null>(
    null,
  );

  const activeProjectId = React.useMemo(() => {
    if (pathname.startsWith("/projects/")) {
      return pathname.slice("/projects/".length);
    }
    if (pathname.startsWith("/boards/")) {
      const boardId = pathname.slice("/boards/".length);
      return boards.find((board) => board.id === boardId)?.projectId ?? null;
    }
    return null;
  }, [boards, pathname]);

  function toggleProject(projectId: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function expandFolder(folderId: string) {
    setCollapsedFolders((current) => {
      if (!current.has(folderId)) return current;
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
  }

  const active = React.useMemo(
    () => projects.filter((project) => !project.archived),
    [projects],
  );
  const archived = React.useMemo(
    () => projects.filter((project) => project.archived),
    [projects],
  );

  const hierarchies = React.useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof buildProjectHierarchy>
    >();
    for (const project of projects) {
      map.set(
        project.id,
        buildProjectHierarchy(project.id, folders, boards),
      );
    }
    return map;
  }, [boards, folders, projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
      // Only a drag handle starts a drag, so clicking a board link navigates.
      bypassActivationConstraint: ({ event }) =>
        event.target instanceof Element &&
        Boolean(event.target.closest("[data-drag-handle]")),
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeType, setActiveType] = React.useState<DragData["type"] | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    setActiveType(data?.type ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveType(null);
    const { active: dragged, over } = event;
    if (!over) return;
    const data = dragged.data.current as DragData | undefined;
    if (!data) return;

    if (data.type === "project") {
      if (dragged.id === over.id) return;
      const ids = active.map((project) => project.id);
      const oldIndex = ids.indexOf(String(dragged.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      // Reorder affects only active projects; archived keep their positions
      // after them (the server stores the full order we send).
      const reordered = arrayMove(active, oldIndex, newIndex).map((p) => p.id);
      const fullOrder = [...reordered, ...archived.map((p) => p.id)];
      void onReorderProjects(fullOrder).catch((error) =>
        toast.error("Could not reorder projects", { description: errorMessage(error) }),
      );
      return;
    }

    const overData = over.data.current as DragData | undefined;
    const translated = dragged.rect.current.translated;
    const centerY = translated
      ? translated.top + translated.height / 2
      : null;
    const afterRow = (ratio = 0.5) =>
      centerY !== null && centerY > over.rect.top + over.rect.height * ratio;
    const folderDropMode =
      centerY === null
        ? "inside"
        : centerY < over.rect.top + over.rect.height * 0.3
          ? "before"
          : centerY > over.rect.bottom - over.rect.height * 0.3
            ? "after"
            : "inside";

    if (data.type === "board") {
      const boardId = String(dragged.id);
      let destProjectId: string | undefined;
      let destFolderId: string | null = null;

      if (overData?.type === "board") {
        destProjectId = overData.projectId;
        destFolderId = overData.folderId ?? null;
      } else if (overData?.type === "folder") {
        destProjectId = overData.projectId;
        destFolderId =
          folderDropMode === "inside"
            ? (overData.folderId ?? null)
            : (overData.parentId ?? null);
      } else if (overData?.type === "container") {
        destProjectId = overData.projectId;
        destFolderId = overData.folderId ?? null;
      } else if (overData?.type === "project") {
        destProjectId = overData.projectId;
        destFolderId = null;
      }
      if (!destProjectId) return;

      const destBoards = boards
        .filter(
          (board) =>
            board.projectId === destProjectId &&
            (board.folderId ?? null) === destFolderId,
        )
        .sort(byPosition)
        .map((board) => board.id);
      const sourceContainer = data.folderId ?? null;
      const sameContainer =
        data.projectId === destProjectId &&
        sourceContainer === destFolderId;
      const overBoardId =
        overData?.type === "board" ? String(over.id) : null;

      let nextIds: string[];
      if (sameContainer && overBoardId) {
        const oldIndex = destBoards.indexOf(boardId);
        const overIndex = destBoards.indexOf(overBoardId);
        if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) {
          return;
        }
        nextIds = arrayMove(destBoards, oldIndex, overIndex);
      } else {
        const without = destBoards.filter((id) => id !== boardId);
        let insertAt = without.length;
        if (overBoardId) {
          const overIndex = without.indexOf(overBoardId);
          if (overIndex !== -1) insertAt = overIndex + (afterRow() ? 1 : 0);
        }
        nextIds = [...without];
        nextIds.splice(
          Math.max(0, Math.min(insertAt, nextIds.length)),
          0,
          boardId,
        );
        if (sameContainer && nextIds.join() === destBoards.join()) return;
      }

      if (destFolderId) expandFolder(destFolderId);
      void onMoveBoards(destProjectId, destFolderId, nextIds).catch((error) =>
        toast.error("Could not move space", { description: errorMessage(error) }),
      );
      return;
    }

    if (data.type === "folder") {
      const folderId = data.folderId;
      const projectId = data.projectId;
      if (!folderId || !projectId) return;

      let parentId: string | null = null;
      let overRowId: string | null = null;
      let insertBefore = false;

      if (overData?.type === "folder") {
        if (!overData.folderId || overData.folderId === folderId) return;
        if (folderDropMode === "inside") {
          parentId = overData.folderId;
        } else {
          parentId = overData.parentId ?? null;
          overRowId = overData.folderId;
          insertBefore = folderDropMode === "before";
        }
      } else if (overData?.type === "container") {
        parentId = overData.folderId ?? null;
      } else if (overData?.type === "project") {
        parentId = null;
      } else if (overData?.type === "board") {
        // Dropping a folder onto a space targets that space's container.
        parentId = overData.folderId ?? null;
      } else {
        return;
      }

      if (parentId && folderSubtreeIds(folders, folderId).has(parentId)) {
        return;
      }

      const siblings = folders
        .filter(
          (folder) =>
            folder.projectId === projectId &&
            (folder.parentId ?? null) === parentId &&
            folder.id !== folderId,
        )
        .sort(byPosition);
      let index = siblings.length;
      if (overRowId) {
        const overIndex = siblings.findIndex(
          (folder) => folder.id === overRowId,
        );
        if (overIndex !== -1) index = overIndex + (insertBefore ? 0 : 1);
      }

      const current = folders
        .filter(
          (folder) =>
            folder.projectId === projectId &&
            (folder.parentId ?? null) === parentId,
        )
        .sort(byPosition)
        .map((folder) => folder.id);
      const next = siblings.map((folder) => folder.id);
      next.splice(Math.max(0, Math.min(index, next.length)), 0, folderId);
      if (next.join() === current.join()) return;

      if (parentId) expandFolder(parentId);
      void onMoveFolder(folderId, parentId, index).catch((error) =>
        toast.error("Could not move folder", {
          description: errorMessage(error),
        }),
      );
    }
  }

  const syncLabel =
    sync?.phase === "syncing"
      ? "Syncing…"
      : sync?.phase === "error"
        ? "Sync needs attention"
        : sync?.phase === "subscription_required"
          ? "Subscription required"
          : sync?.phase === "idle"
            ? "Cloud sync enabled"
            : "Sign in to enable sync";

  function openAccount() {
    onNavigate?.();
    navigate("/account");
  }

  async function handleArchive(project: ProjectSummary) {
    try {
      await api(`/api/projects/${project.id}/archive`, { method: "POST" });
      await onRefresh();
    } catch (error) {
      toast.error("Could not archive project", { description: errorMessage(error) });
    }
  }

  async function handleRestore(project: ProjectSummary) {
    try {
      await api(`/api/projects/${project.id}/restore`, { method: "POST" });
      await onRefresh();
    } catch (error) {
      toast.error("Could not restore project", { description: errorMessage(error) });
    }
  }

  const refresh = () => void onRefresh();

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "flex",
          collapsed
            ? "flex-col items-center gap-2 px-2 pt-4 pb-1"
            : "flex-row items-center justify-between pt-5 pb-4 px-4",
        )}
      >
        <Logo compact={collapsed} showTagline={!collapsed} />
        {showClose ? (
          <div className="flex items-center gap-1">
            <ThemeToggle showTooltip={false} />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          onToggleCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-controls="workspace-sidebar"
                  aria-expanded={!collapsed}
                >
                  {collapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          )
        )}
      </div>

      <div className={cn(collapsed ? "px-3 pb-1" : "px-3 pb-3")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenSearch}
                aria-label="Search"
                className="mx-auto flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <Search className="size-4 opacity-70" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search (⌘K)</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={onOpenSearch}
            className="group flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/50 px-2.5 text-[13px] text-muted-foreground shadow-[0_1px_0_oklch(1_0_0/0.4)_inset] transition-colors hover:border-sidebar-border/80 hover:bg-background/80 hover:text-foreground"
          >
            <Search className="size-3.5 opacity-70" />
            <span>Search</span>
            <span className="ml-auto flex items-center gap-0.5">
              <Kbd className="h-[18px] min-w-[18px] border-sidebar-border bg-sidebar text-[9px]">
                ⌘
              </Kbd>
              <Kbd className="h-[18px] min-w-[18px] border-sidebar-border bg-sidebar text-[9px]">
                K
              </Kbd>
            </span>
          </button>
        )}
      </div>

      <nav className={cn("px-3 space-y-1", collapsed ? "py-1" : "")} aria-label="Workspace">
        <SidebarLink
          href="/"
          icon={LayoutDashboard}
          active={pathname === "/"}
          label="Overview"
          collapsed={collapsed}
          onClick={onNavigate}
        />
        <SidebarLink
          href="/calendar"
          icon={CalendarDays}
          active={pathname === "/calendar"}
          label="Calendar"
          collapsed={collapsed}
          onClick={onNavigate}
        />
        {conflictCount > 0 && (
          <SidebarLink
            href="/conflicts"
            icon={TriangleAlert}
            active={pathname === "/conflicts"}
            label="Sync conflicts"
            badge={conflictCount}
            collapsed={collapsed}
            onClick={onNavigate}
          />
        )}
      </nav>

      <div className={cn("flex min-h-0 flex-1 flex-col", !collapsed && "mt-5")}>
        <div
          className={cn(
            "flex items-center",
            collapsed
              ? "justify-center"
              : "justify-between px-5 pb-1.5",
          )}
        >
          {!collapsed && (
            <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Projects
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCreateProjectOpen(true)}
                className={cn(
                  "grid place-items-center text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  collapsed ? "size-8 rounded-lg" : "size-5 rounded",
                )}
                aria-label="Create project"
              >
                <FolderPlus className={collapsed ? "size-4" : "size-3.5"} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New project</TooltipContent>
          </Tooltip>
        </div>

        <div
          className={cn(
            "scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-3",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {collapsed ? (
            active.length > 0 && (
              <ul className="space-y-1">
                {active.map((project) => (
                  <CompactProjectLink
                    key={project.id}
                    project={project}
                    active={activeProjectId === project.id}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )
          ) : active.length === 0 && archived.length === 0 ? (
            <div className="mx-2 rounded-lg border border-dashed border-sidebar-border px-3 py-4 text-center">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                No projects yet.
              </p>
              <button
                type="button"
                onClick={() => setCreateProjectOpen(true)}
                className="mt-1.5 text-[11.5px] font-medium text-primary hover:underline"
              >
                Create your first project
              </button>
            </div>
          ) : (
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveType(null)}
            >
              <SortableContext
                items={active.map((project) => project.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1.5">
                  {active.map((project) => (
                    <SortableProjectGroup
                      key={project.id}
                      project={project}
                      hierarchy={
                        hierarchies.get(project.id) ?? EMPTY_HIERARCHY
                      }
                      pathname={pathname}
                      expanded={!collapsedProjects.has(project.id)}
                      draggingBoard={activeType === "board"}
                      draggingFolder={activeType === "folder"}
                      collapsedFolders={collapsedFolders}
                      onNavigate={onNavigate}
                      onToggleExpanded={() => toggleProject(project.id)}
                      onToggleFolder={toggleFolder}
                      onCreateBoard={(folderId) =>
                        onCreateBoard(project.id, folderId)
                      }
                      onCreateFolder={(parentId, parentName) =>
                        setCreateFolder({
                          projectId: project.id,
                          parentId,
                          parentName,
                        })
                      }
                      onFolderSettings={setFolderSettings}
                      onDeleteFolder={setDeleteFolder}
                      onOpenProject={() => {
                        onNavigate?.();
                        navigate(`/projects/${project.id}`);
                      }}
                      onRename={() => setRenameProject(project)}
                      onArchive={() => void handleArchive(project)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {!collapsed && archived.length > 0 && (
            <ArchivedSection
              projects={archived}
              onOpen={(project) => {
                onNavigate?.();
                navigate(`/projects/${project.id}`);
              }}
              onRestore={(project) => void handleRestore(project)}
              onDelete={(project) => setDeleteProject(project)}
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "mt-auto border-t border-sidebar-border/80 py-3",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-lg text-left transition-colors hover:bg-sidebar-accent/60",
                collapsed ? "justify-center px-0 py-2" : "px-2 py-1.5",
              )}
              aria-label={
                collapsed ? `Account menu for ${user.name}` : "Account menu"
              }
              title={collapsed ? `${user.name} — ${syncLabel}` : undefined}
            >
              <span
                className={cn(
                  "relative grid shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary",
                  collapsed ? "size-9 text-[11px]" : "size-7 text-[10px]",
                )}
              >
                {initial}
                {collapsed && sync?.phase === "error" && (
                  <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-warning ring-2 ring-sidebar" />
                )}
              </span>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{user.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {syncLabel}
                    </p>
                  </div>
                  <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? "right" : "top"}
            align={collapsed ? "end" : "start"}
            className="w-[248px]"
          >
            <DropdownMenuLabel>Settings</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette />
                Appearance
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                  <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onOpenShortcuts}>
              <Keyboard />
              Keyboard shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openAccount}>
              <UserRound />
              Account
            </DropdownMenuItem>
            {sync?.lastSyncedAt && (
              <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">
                Last synced{" "}
                {new Date(sync.lastSyncedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </DropdownMenuLabel>
            )}
            {sync?.phase === "error" && sync.lastError && (
              <DropdownMenuItem
                onSelect={() => void window.masarDesktop?.syncNow()}
                className="text-warning"
              >
                <Settings2 />
                Retry sync
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onDone={refresh}
      />
      <RenameProjectDialog
        project={renameProject}
        open={renameProject !== null}
        onOpenChange={(open) => !open && setRenameProject(null)}
        onDone={refresh}
      />
      <DeleteProjectDialog
        project={deleteProject}
        open={deleteProject !== null}
        onOpenChange={(open) => !open && setDeleteProject(null)}
        onDeleted={refresh}
      />
      {createFolder && (
        <CreateFolderDialog
          open
          projectId={createFolder.projectId}
          parentId={createFolder.parentId}
          parentName={createFolder.parentName}
          onOpenChange={(open) => !open && setCreateFolder(null)}
          onDone={refresh}
        />
      )}
      <FolderSettingsDialog
        folder={folderSettings}
        folders={folders}
        open={folderSettings !== null}
        onOpenChange={(open) => !open && setFolderSettings(null)}
        onDone={refresh}
      />
      <DeleteFolderDialog
        folder={deleteFolder}
        folders={folders}
        open={deleteFolder !== null}
        onOpenChange={(open) => !open && setDeleteFolder(null)}
        onDeleted={refresh}
      />
    </div>
  );
}

const BOARD_TYPE_ICON = {
  kanban: LayoutGrid,
  whiteboard: PenLine,
  note: FileText,
} as const;

const EMPTY_HIERARCHY: ProjectHierarchy = { folders: [], boards: [] };

function countSpaces(node: FolderTreeNode): number {
  return (
    node.boards.length +
    node.folders.reduce((total, child) => total + countSpaces(child), 0)
  );
}

function SortableProjectGroup({
  project,
  hierarchy,
  pathname,
  expanded,
  draggingBoard,
  draggingFolder,
  collapsedFolders,
  onNavigate,
  onToggleExpanded,
  onToggleFolder,
  onCreateBoard,
  onCreateFolder,
  onFolderSettings,
  onDeleteFolder,
  onOpenProject,
  onRename,
  onArchive,
}: {
  project: ProjectSummary;
  hierarchy: ProjectHierarchy;
  pathname: string;
  expanded: boolean;
  draggingBoard: boolean;
  draggingFolder: boolean;
  collapsedFolders: Set<string>;
  onNavigate?: () => void;
  onToggleExpanded: () => void;
  onToggleFolder: (folderId: string) => void;
  onCreateBoard: (folderId?: string | null) => void;
  onCreateFolder: (parentId: string | null, parentName?: string) => void;
  onFolderSettings: (folder: FolderSummary) => void;
  onDeleteFolder: (folder: FolderSummary) => void;
  onOpenProject: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, data: { type: "project" } satisfies DragData });

  // A droppable for the project's root contents so a space or folder can be
  // dropped onto a collapsed or empty project.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `project-drop:${project.id}`,
    data: {
      type: "container",
      projectId: project.id,
      folderId: null,
    } satisfies DragData,
  });

  const projectActive = pathname === `/projects/${project.id}`;
  const dragging = draggingBoard || draggingFolder;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/project", isDragging && "relative z-20 opacity-60")}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg pr-1 text-[13px] transition-colors",
          projectActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/90 hover:bg-sidebar-accent/50",
          isOver && dragging && "ring-2 ring-primary/60",
        )}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-sidebar-foreground"
          aria-label={expanded ? "Collapse project" : "Expand project"}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={onOpenProject}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{project.name}</span>
          {project.boardCount > 0 && (
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {project.boardCount}
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 transition-colors group-hover/project:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:text-sidebar-foreground"
              aria-label={`Add to ${project.name}`}
              title="Add a space or folder"
            >
              <Plus className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[170px]">
            <DropdownMenuItem onSelect={() => onCreateBoard(null)}>
              <Plus />
              New space
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCreateFolder(null)}>
              <FolderPlus />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ProjectActionsMenu onRename={onRename} onArchive={onArchive} />
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-drag-handle=""
          className="grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/0 transition-colors group-hover/project:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground active:cursor-grabbing"
          aria-label={`Reorder project ${project.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div
          ref={setDropRef}
          className={cn(
            "mt-0.5 ml-5 min-h-[2px] rounded-md transition-colors",
            isOver && dragging && "bg-sidebar-accent/30",
          )}
        >
          <SortableContext
            items={hierarchy.folders.map((node) => node.folder.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">
              {hierarchy.folders.map((node) => (
                <SortableFolderNode
                  key={node.folder.id}
                  node={node}
                  projectId={project.id}
                  pathname={pathname}
                  expanded={!collapsedFolders.has(node.folder.id)}
                  dragging={dragging}
                  collapsedFolders={collapsedFolders}
                  onNavigate={onNavigate}
                  onToggleFolder={onToggleFolder}
                  onCreateBoard={onCreateBoard}
                  onCreateFolder={onCreateFolder}
                  onFolderSettings={onFolderSettings}
                  onDeleteFolder={onDeleteFolder}
                />
              ))}
            </ul>
          </SortableContext>

          <SortableContext
            items={hierarchy.boards.map((board) => board.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">
              {hierarchy.boards.map((board) => (
                <SortableBoardLink
                  key={board.id}
                  board={board}
                  active={pathname === `/boards/${board.id}`}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </SortableContext>
        </div>
      )}
    </li>
  );
}

function SortableFolderNode({
  node,
  projectId,
  pathname,
  expanded,
  dragging,
  collapsedFolders,
  onNavigate,
  onToggleFolder,
  onCreateBoard,
  onCreateFolder,
  onFolderSettings,
  onDeleteFolder,
}: {
  node: FolderTreeNode;
  projectId: string;
  pathname: string;
  expanded: boolean;
  dragging: boolean;
  collapsedFolders: Set<string>;
  onNavigate?: () => void;
  onToggleFolder: (folderId: string) => void;
  onCreateBoard: (folderId?: string | null) => void;
  onCreateFolder: (parentId: string | null, parentName?: string) => void;
  onFolderSettings: (folder: FolderSummary) => void;
  onDeleteFolder: (folder: FolderSummary) => void;
}) {
  const folder = node.folder;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: folder.id,
    data: {
      type: "folder",
      projectId,
      folderId: folder.id,
      parentId: folder.parentId,
    } satisfies DragData,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-drop:${folder.id}`,
    data: {
      type: "container",
      projectId,
      folderId: folder.id,
    } satisfies DragData,
  });
  const Icon = expanded ? FolderOpen : Folder;
  const spaceCount = countSpaces(node);

  return (
    <li className="group/folder">
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg pr-1 text-[13px] transition-colors",
          pathname === `/projects/${projectId}` &&
            "text-sidebar-foreground/80",
          isOver && dragging && "ring-2 ring-primary/40",
          isDragging && "relative z-20 opacity-60",
          "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
      >
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-sidebar-foreground"
          aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
          {spaceCount > 0 && (
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {spaceCount}
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 transition-colors group-hover/folder:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:text-sidebar-foreground"
              aria-label={`Add to ${folder.name}`}
              title="Add a space or folder"
            >
              <Plus className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[170px]">
            <DropdownMenuItem onSelect={() => onCreateBoard(folder.id)}>
              <Plus />
              New space
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onCreateFolder(folder.id, folder.name)}
            >
              <FolderPlus />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <FolderActionsMenu
          folder={folder}
          onSettings={() => onFolderSettings(folder)}
          onDelete={() => onDeleteFolder(folder)}
        />
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-drag-handle=""
          className="grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/0 transition-colors group-hover/folder:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          aria-label={`Move folder ${folder.name}`}
          title="Drag to reorder or move into another folder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div
          ref={setDropRef}
          className={cn(
            "ml-3 rounded-md border-l border-sidebar-border/60 pl-1.5 transition-colors",
            isOver && dragging && "bg-sidebar-accent/30",
          )}
        >
          <SortableContext
            items={node.folders.map((child) => child.folder.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">
              {node.folders.map((child) => (
                <SortableFolderNode
                  key={child.folder.id}
                  node={child}
                  projectId={projectId}
                  pathname={pathname}
                  expanded={!collapsedFolders.has(child.folder.id)}
                  dragging={dragging}
                  collapsedFolders={collapsedFolders}
                  onNavigate={onNavigate}
                  onToggleFolder={onToggleFolder}
                  onCreateBoard={onCreateBoard}
                  onCreateFolder={onCreateFolder}
                  onFolderSettings={onFolderSettings}
                  onDeleteFolder={onDeleteFolder}
                />
              ))}
            </ul>
          </SortableContext>

          <SortableContext
            items={node.boards.map((board) => board.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">
              {node.boards.map((board) => (
                <SortableBoardLink
                  key={board.id}
                  board={board}
                  active={pathname === `/boards/${board.id}`}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </SortableContext>
        </div>
      )}
    </li>
  );
}

function FolderActionsMenu({
  folder,
  onSettings,
  onDelete,
}: {
  folder: FolderSummary;
  onSettings: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/0 transition-colors group-hover/folder:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:text-sidebar-foreground"
          aria-label={`Folder actions for ${folder.name}`}
        >
          <Settings2 className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[190px]">
        <DropdownMenuItem onSelect={onSettings}>
          <Pencil />
          Rename or move
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive">
          <Trash2 />
          Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectActionsMenu({
  onRename,
  onArchive,
}: {
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/0 transition-colors group-hover/project:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:text-sidebar-foreground"
          aria-label="Project actions"
        >
          <Settings2 className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[160px]">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onArchive}>
          <Archive />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedSection({
  projects,
  onOpen,
  onRestore,
  onDelete,
}: {
  projects: ProjectSummary[];
  onOpen: (project: ProjectSummary) => void;
  onRestore: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-3 border-t border-sidebar-border/60 pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-sidebar-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Archived
        <span className="tabular-nums">({projects.length})</span>
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {projects.map((project) => (
            <li
              key={project.id}
              className="group/archived flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-muted-foreground"
            >
              <Archive className="size-3.5 shrink-0 opacity-50" />
              <button
                type="button"
                onClick={() => onOpen(project)}
                className="min-w-0 flex-1 truncate text-left hover:text-sidebar-foreground hover:underline"
              >
                {project.name}
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onRestore(project)}
                      className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      aria-label={`Restore ${project.name}`}
                    >
                      <ArchiveRestore className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Restore</TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => onDelete(project)}
                  className="grid size-5 place-items-center rounded text-muted-foreground/0 transition-colors group-hover/archived:text-muted-foreground hover:bg-sidebar-accent hover:text-destructive"
                  aria-label={`Delete ${project.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompactProjectLink({
  project,
  active,
  onNavigate,
}: {
  project: ProjectSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const initial = (project.name.trim()[0] ?? "•").toUpperCase();
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={`/projects/${project.id}`}
            onClick={onNavigate}
            aria-label={project.name}
            className={cn(
              "mx-auto grid size-9 place-items-center rounded-lg text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "bg-sidebar-accent/35 text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
            )}
          >
            {initial}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {project.name}
          <span className="ml-1 text-background/60">
            {project.boardCount} {project.boardCount === 1 ? "space" : "spaces"}
          </span>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function SortableBoardLink({
  board,
  active,
  onNavigate,
}: {
  board: BoardSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: board.id,
    data: {
      type: "board",
      projectId: board.projectId ?? undefined,
      folderId: board.folderId,
    } satisfies DragData,
  });
  const handlePointerDown = listeners?.onPointerDown as
    | React.PointerEventHandler<HTMLElement>
    | undefined;
  const TypeIcon = BOARD_TYPE_ICON[board.type] ?? LayoutGrid;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-board-id={board.id}
      className={cn("group/board", isDragging && "relative z-20 opacity-60")}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg pr-1 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <Link
          to={`/boards/${board.id}`}
          onClick={onNavigate}
          onPointerDown={handlePointerDown}
          draggable={false}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TypeIcon
            className={cn(
              "size-3.5 shrink-0",
              active ? "opacity-100" : "opacity-80",
            )}
          />
          <span className="truncate">{board.name}</span>
          {board.type === "kanban" && board.taskCount > 0 && (
            <span
              className={cn(
                "ml-auto text-[10px] tabular-nums",
                active
                  ? "text-sidebar-accent-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {board.taskCount}
            </span>
          )}
        </Link>
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-drag-handle=""
          className="grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing sm:text-muted-foreground/0 sm:group-hover/board:text-muted-foreground sm:group-focus-within/board:text-muted-foreground"
          aria-label={`Reorder space ${board.name}`}
          title="Drag to reorder or move between projects"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  active,
  label,
  badge,
  collapsed,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  label: string;
  badge?: number;
  collapsed: boolean;
  onClick?: () => void;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={href}
            onClick={onClick}
            aria-label={badge ? `${label} (${badge})` : label}
            className={cn(
              "relative mx-auto flex size-9 items-center justify-center rounded-lg transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 opacity-80" />
            {badge ? (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-3.5 place-items-center rounded-full bg-warning px-1 text-[9px] font-semibold tabular-nums text-background ring-2 ring-sidebar">
                {badge}
              </span>
            ) : null}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {badge ? `${label} (${badge})` : label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      to={href}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-4 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-warning/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-warning">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
