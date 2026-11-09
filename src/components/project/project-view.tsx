import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckCircle2,
  FileText,
  LayoutGrid,
  Pencil,
  PenLine,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { CreateBoardDialog } from "@/components/board/create-board-dialog";
import { PageSurface } from "@/components/layout/page-surface";
import { RenameProjectDialog } from "@/components/project/project-dialogs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/dates";
import type { ProjectDetail } from "@/lib/types";

const TYPE_ICON = { kanban: LayoutGrid, whiteboard: PenLine, note: FileText } as const;

export function ProjectView({
  initialData,
  onChanged,
}: {
  initialData: ProjectDetail;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const project = initialData.project;
  const boards = initialData.boards;
  const totals = initialData.totals;
  const completion =
    totals.tasks > 0 ? Math.round((totals.done / totals.tasks) * 100) : 0;

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
                <Button size="sm" onClick={() => setCreateOpen(true)}>
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

        <section className="mt-7">
          {boards.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-14 text-center">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Plus className="size-5" />
              </span>
              <div>
                <p className="text-[14px] font-medium">No spaces in this project yet</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Add a Kanban space, a whiteboard or a note to get started.
                </p>
              </div>
              {!project.archived && (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New space
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => {
                const Icon = TYPE_ICON[board.type] ?? LayoutGrid;
                const pct =
                  board.taskCount > 0
                    ? Math.round((board.doneCount / board.taskCount) * 100)
                    : 0;
                return (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => navigate(`/boards/${board.id}`)}
                    className="group animate-rise rounded-xl border border-border/70 bg-card p-4 text-left transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="truncate text-[14px] font-medium">
                        {board.name}
                      </span>
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
                          {board.doneCount}/{board.taskCount} done · {board.columnCount} columns
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-[11.5px] text-muted-foreground">
                        {board.type === "note" ? "Note" : "Whiteboard canvas"}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
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
                  Task and whiteboard updates in this project.
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
        open={createOpen}
        projectId={project.id}
        onOpenChange={setCreateOpen}
        onCreated={() => onChanged?.()}
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
