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
  FolderPlus,
  GripVertical,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Palette,
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
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { useTheme, type Theme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  CreateProjectDialog,
  DeleteProjectDialog,
  RenameProjectDialog,
} from "@/components/project/project-dialogs";
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
import { useSyncStatus } from "@/lib/use-sync-status";
import type { BoardSummary, ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarContentProps {
  projects: ProjectSummary[];
  boards: BoardSummary[];
  conflictCount: number;
  user: { name: string; email: string };
  onOpenSearch: () => void;
  onCreateBoard: (projectId: string | null) => void;
  onOpenShortcuts: () => void;
  onReorderProjects: (projectIds: string[]) => Promise<void>;
  onMoveBoards: (projectId: string, boardIds: string[]) => Promise<void>;
  onRefresh: () => Promise<void> | void;
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}

interface DragData {
  type: "project" | "board";
  projectId?: string;
}

export function SidebarContent({
  projects,
  boards,
  conflictCount,
  user,
  onOpenSearch,
  onCreateBoard,
  onOpenShortcuts,
  onReorderProjects,
  onMoveBoards,
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

  const active = React.useMemo(
    () => projects.filter((project) => !project.archived),
    [projects],
  );
  const archived = React.useMemo(
    () => projects.filter((project) => project.archived),
    [projects],
  );

  const boardsByProject = React.useMemo(() => {
    const map = new Map<string, BoardSummary[]>();
    for (const board of boards) {
      if (!board.projectId) continue;
      const list = map.get(board.projectId) ?? [];
      list.push(board);
      map.set(board.projectId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [boards]);

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

    // Board drag: resolve the destination project from the drop target.
    const overData = over.data.current as DragData | undefined;
    const boardId = String(dragged.id);
    const sourceProjectId = data.projectId;
    const destProjectId =
      overData?.type === "board"
        ? overData.projectId
        : overData?.type === "project"
          ? overData.projectId
          : (String(over.id).startsWith("project-drop:")
              ? String(over.id).slice("project-drop:".length)
              : undefined);
    if (!destProjectId) return;

    const destBoards = (boardsByProject.get(destProjectId) ?? []).map((b) => b.id);
    let nextIds: string[];
    if (sourceProjectId === destProjectId) {
      const oldIndex = destBoards.indexOf(boardId);
      const overIndex =
        overData?.type === "board" ? destBoards.indexOf(String(over.id)) : destBoards.length - 1;
      if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) return;
      nextIds = arrayMove(destBoards, oldIndex, overIndex);
    } else {
      const insertAt =
        overData?.type === "board"
          ? Math.max(0, destBoards.indexOf(String(over.id)))
          : destBoards.length;
      nextIds = [...destBoards];
      nextIds.splice(insertAt, 0, boardId);
    }
    void onMoveBoards(destProjectId, nextIds).catch((error) =>
      toast.error("Could not move board", { description: errorMessage(error) }),
    );
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
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <Logo />
        {showClose && (
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
        )}
      </div>

      <div className="px-3 pb-3">
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
      </div>

      <nav className="px-3" aria-label="Workspace">
        <SidebarLink
          href="/"
          icon={LayoutDashboard}
          active={pathname === "/"}
          onClick={onNavigate}
        >
          Overview
        </SidebarLink>
        <SidebarLink
          href="/calendar"
          icon={CalendarDays}
          active={pathname === "/calendar"}
          onClick={onNavigate}
        >
          Calendar
        </SidebarLink>
        {conflictCount > 0 && (
          <SidebarLink
            href="/conflicts"
            icon={TriangleAlert}
            active={pathname === "/conflicts"}
            onClick={onNavigate}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">Sync conflicts</span>
              <span className="ml-auto rounded-full bg-warning/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-warning">
                {conflictCount}
              </span>
            </span>
          </SidebarLink>
        )}
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-1.5">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Projects
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCreateProjectOpen(true)}
                className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                aria-label="Create project"
              >
                <FolderPlus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New project</TooltipContent>
          </Tooltip>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {active.length === 0 && archived.length === 0 ? (
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
                      boards={boardsByProject.get(project.id) ?? []}
                      pathname={pathname}
                      draggingBoard={activeType === "board"}
                      onNavigate={onNavigate}
                      onCreateBoard={() => onCreateBoard(project.id)}
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

          {archived.length > 0 && (
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

      <div className="mt-auto border-t border-sidebar-border/80 px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
              aria-label="Account menu"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {syncLabel}
                </p>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[248px]">
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
    </div>
  );
}

const BOARD_TYPE_ICON = {
  kanban: LayoutGrid,
  whiteboard: PenLine,
} as const;

function SortableProjectGroup({
  project,
  boards,
  pathname,
  draggingBoard,
  onNavigate,
  onCreateBoard,
  onOpenProject,
  onRename,
  onArchive,
}: {
  project: ProjectSummary;
  boards: BoardSummary[];
  pathname: string;
  draggingBoard: boolean;
  onNavigate?: () => void;
  onCreateBoard: () => void;
  onOpenProject: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, data: { type: "project" } satisfies DragData });

  // A droppable for the whole project so a board can be dropped onto a
  // collapsed or empty project.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `project-drop:${project.id}`,
    data: { type: "project", projectId: project.id } satisfies DragData,
  });

  const projectActive = pathname === `/projects/${project.id}`;

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
          isOver && draggingBoard && "ring-2 ring-primary/60",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
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
          {boards.length > 0 && (
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {boards.length}
            </span>
          )}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreateBoard}
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/0 transition-colors group-hover/project:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label={`Add board to ${project.name}`}
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New board</TooltipContent>
        </Tooltip>
        <ProjectActionsMenu
          onRename={onRename}
          onArchive={onArchive}
          onAddBoard={onCreateBoard}
        />
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
        <div ref={setDropRef} className="mt-0.5 ml-5 min-h-[2px]">
          {boards.length === 0 ? (
            <button
              type="button"
              onClick={onCreateBoard}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                isOver && draggingBoard && "bg-sidebar-accent/40",
              )}
            >
              <Plus className="size-3" />
              Add a board
            </button>
          ) : (
            <SortableContext
              items={boards.map((board) => board.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-0.5">
                {boards.map((board) => (
                  <SortableBoardLink
                    key={board.id}
                    board={board}
                    active={pathname === `/boards/${board.id}`}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </SortableContext>
          )}
        </div>
      )}
    </li>
  );
}

function ProjectActionsMenu({
  onRename,
  onArchive,
  onAddBoard,
}: {
  onRename: () => void;
  onArchive: () => void;
  onAddBoard: () => void;
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
      <DropdownMenuContent align="start" className="w-[180px]">
        <DropdownMenuItem onSelect={onAddBoard}>
          <Plus />
          New board
        </DropdownMenuItem>
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
    data: { type: "board", projectId: board.projectId ?? undefined } satisfies DragData,
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
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              BOARD_COLOR_CLASS[board.color],
              "board-dot",
              active ? "opacity-100" : "opacity-70",
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
          aria-label={`Reorder board ${board.name}`}
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
  children,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
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
      {children}
    </Link>
  );
}
