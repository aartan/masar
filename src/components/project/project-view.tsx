import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  LayoutGrid,
  PenLine,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { CreateBoardDialog } from "@/components/board/create-board-dialog";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client-api";
import type { ProjectDetail } from "@/lib/types";

const TYPE_ICON = { kanban: LayoutGrid, whiteboard: PenLine } as const;

export function ProjectView({
  initialData,
  onChanged,
}: {
  initialData: ProjectDetail;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = React.useState(false);
  const project = initialData.project;
  const boards = initialData.boards;

  const totals = React.useMemo(() => {
    const tasks = boards.reduce((sum, board) => sum + board.taskCount, 0);
    const done = boards.reduce((sum, board) => sum + board.doneCount, 0);
    return { tasks, done, pct: tasks > 0 ? Math.round((done / tasks) * 100) : 0 };
  }, [boards]);

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
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[1220px] px-5 py-8">
        <header className="animate-rise">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
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
                  New board
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {boards.length} board{boards.length === 1 ? "" : "s"} ·{" "}
            {totals.tasks} task{totals.tasks === 1 ? "" : "s"} · {totals.pct}% complete
          </p>
        </header>

        <section className="mt-7">
          {boards.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-3 border-dashed py-14 text-center">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Plus className="size-5" />
              </span>
              <div>
                <p className="text-[14px] font-medium">No boards in this project yet</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Add a Kanban board or a whiteboard to get started.
                </p>
              </div>
              {!project.archived && (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New board
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
                      <span
                        className={cnDot(board.color)}
                        aria-hidden
                      />
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
                        Whiteboard canvas
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <CreateBoardDialog
        open={createOpen}
        projectId={project.id}
        onOpenChange={setCreateOpen}
        onCreated={() => onChanged?.()}
      />
      <ProjectBackLink />
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

function cnDot(color: string): string {
  return `size-2.5 shrink-0 rounded-full board-dot ${BOARD_COLOR_CLASS[color as keyof typeof BOARD_COLOR_CLASS] ?? ""}`;
}
