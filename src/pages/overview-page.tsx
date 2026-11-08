import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FolderKanban,
  Layers,
  LayoutGrid,
  ListTodo,
  PenLine,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";

import { api } from "@/lib/client-api";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import { completionPercent } from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/lib/types";
import { PageSkeleton, PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DueDateChip, PriorityBars } from "@/components/shared/task-meta";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { EmptyState, PageSectionTitle } from "@/components/shared/empty-state";
import { NewBoardButton } from "@/components/board/new-board-button";

const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  none: "bg-muted-foreground/30",
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function OverviewPage() {
  const { projects, boards } = useWorkspace();
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const showSkeleton = useDelayedLoading(!data);

  React.useEffect(() => {
    let active = true;
    void api<{ dashboard: DashboardData }>("/api/dashboard")
      .then((result) => {
        if (active) setData(result.dashboard);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load the overview.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useOnSyncComplete(() => {
    void api<{ dashboard: DashboardData }>("/api/dashboard")
      .then((result) => {
        setData(result.dashboard);
        setError(null);
      })
      .catch(() => {
        /* Keep the current overview if a background refresh fails. */
      });
  });

  if (!data) {
    if (error) {
      return (
        <PageSurface className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-[13px] font-medium">Could not load the overview</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{error}</p>
          </div>
        </PageSurface>
      );
    }

    if (!showSkeleton) {
      return <div className="h-full" aria-busy="true" />;
    }

    return (
      <PageSkeleton label="Loading overview" scroll>
        <OverviewSkeleton
          projectCount={projects.length}
          boardCount={boards.length}
        />
      </PageSkeleton>
    );
  }

  return <OverviewContent data={data} />;
}

function OverviewContent({ data }: { data: DashboardData }) {
  const completion = completionPercent(data.totals.done, data.totals.tasks);
  const maxPriority = Math.max(
    1,
    ...Object.values(data.priorityCounts),
  );

  return (
    <PageSurface scroll>
      <div className="mx-auto w-full max-w-[1220px] px-5 py-8 sm:px-8 lg:py-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="animate-rise">
            <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
            <h1 className="font-display mt-2 text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
              {greeting()}.
            </h1>
            <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-muted-foreground">
              {data.totals.boards > 0
                ? `A clear view of ${data.totals.boards} ${data.totals.boards === 1 ? "board" : "boards"} and ${data.totals.open} open ${data.totals.open === 1 ? "task" : "tasks"}.`
                : "Your workspace is ready for its first board."}
            </p>
          </div>
        </header>

        {data.totals.boards === 0 && data.totals.projects === 0 ? (
          <section className="mt-10 animate-rise">
            <div className="dot-grid relative overflow-hidden rounded-2xl border border-border/80 bg-card px-6 py-16 shadow-soft sm:px-12">
              <div className="absolute -top-24 -right-16 size-64 rounded-full bg-primary/6 blur-3xl" />
              <div className="relative mx-auto max-w-xl text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="size-6" strokeWidth={1.6} />
                </span>
                <h2 className="font-display mt-5 text-2xl font-semibold">
                  A clear path from backlog to done.
                </h2>
                <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                  Create a board, add your first tasks, and move work through
                  the columns as it progresses. Start with five and shape them
                  as you go.
                </p>
                <div className="mt-6 flex justify-center">
                  <NewBoardButton label="Create your first board" size="lg" />
                </div>
                <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                  {[
                    ["Board", "Structure the work"],
                    ["Flow", "Move work forward"],
                    ["Focus", "See what matters"],
                  ].map(([title, subtitle]) => (
                    <div
                      key={title}
                      className="rounded-lg border border-border/60 bg-background/50 px-3.5 py-3"
                    >
                      <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                        {title}
                      </p>
                      <p className="mt-1 text-[12.5px] text-foreground">
                        {subtitle}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={ListTodo}
                label="Open tasks"
                value={data.totals.open}
                detail={`${data.totals.tasks} total across all boards`}
                delay={0}
              />
              <MetricCard
                icon={CalendarDays}
                label="Due this week"
                value={data.totals.dueSoon}
                detail={
                  data.totals.overdue > 0
                    ? `${data.totals.overdue} overdue right now`
                    : "Nothing overdue"
                }
                tone={data.totals.overdue > 0 ? "warning" : "default"}
                delay={1}
              />
              <MetricCard
                icon={CheckCircle2}
                label="Completed in 7 days"
                value={data.totals.completedLast7Days}
                detail={`${completion}% of all work is done`}
                tone="success"
                delay={2}
              />
              <MetricCard
                icon={Layers}
                label="Active boards"
                value={data.totals.boards}
                detail={`${data.boardStats.reduce((sum, board) => sum + board.open, 0)} tasks in flight`}
                delay={3}
              />
            </section>

            {data.projects.length > 0 && (
              <section className="mt-5 animate-rise" style={{ animationDelay: "160ms" }}>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <PageSectionTitle>Projects</PageSectionTitle>
                    <p className="-mt-2 text-[12px] text-muted-foreground">
                      Progress across every project in this workspace.
                    </p>
                  </div>
                  <FolderKanban className="size-4 text-muted-foreground" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {data.projects.map((project) => {
                    const percent = completionPercent(
                      project.doneCount,
                      project.taskCount,
                    );
                    return (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="group rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-border hover:bg-accent/35"
                      >
                        <div className="flex items-start gap-2">
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary">
                            <FolderKanban className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-semibold">
                              {project.name}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {project.description || "Project"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <LayoutGrid className="size-3" />
                            {project.kanbanCount} Kanban
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <PenLine className="size-3" />
                            {project.whiteboardCount} Whiteboard
                          </span>
                          <span className="ml-auto tabular-nums">
                            {project.doneCount}/{project.taskCount}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70 transition-all group-hover:bg-primary"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <Card className="animate-rise overflow-hidden">
                <CardHeader className="flex-row items-center justify-between pb-1">
                  <div>
                    <PageSectionTitle>Upcoming</PageSectionTitle>
                    <p className="-mt-2 text-[12px] text-muted-foreground">
                      Open tasks with due dates, soonest first.
                    </p>
                  </div>
                  <Badge variant="muted" className="shrink-0">
                    {data.totals.dueSoon + data.totals.overdue} scheduled
                  </Badge>
                </CardHeader>
                <CardContent className="pt-3">
                  {data.upcoming.length === 0 ? (
                    <EmptyState
                      icon={CalendarDays}
                      title="Nothing due soon"
                      description="Add due dates to tasks and they will surface here."
                      compact
                    />
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {data.upcoming.map((task) => (
                        <li key={task.id}>
                          <Link
                            to={`/boards/${task.boardId}?task=${task.id}`}
                            className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50"
                          >
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                BOARD_COLOR_CLASS[task.boardColor],
                                "board-dot",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-foreground">
                                {task.title}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                {task.boardName}
                                <span className="text-muted-foreground">
                                  /
                                </span>
                                {task.columnName}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5">
                              <DueDateChip
                                task={task}
                                columnDone={task.columnIsDone}
                              />
                              <PriorityBars priority={task.priority} />
                              <ArrowRight className="size-3.5 text-muted-foreground/0 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="animate-rise" style={{ animationDelay: "60ms" }}>
                <CardHeader className="pb-1">
                  <PageSectionTitle>Board progress</PageSectionTitle>
                  <p className="-mt-2 text-[12px] text-muted-foreground">
                    Completed work by board.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-3">
                  {data.boardStats.map((board) => {
                    const percent = completionPercent(board.done, board.total);
                    return (
                      <Link
                        key={board.boardId}
                        to={`/boards/${board.boardId}`}
                        className="group block"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              BOARD_COLOR_CLASS[board.color],
                              "board-dot",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                            {board.name}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {board.done}/{board.total}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/70 transition-all group-hover:bg-primary"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                            {percent}%
                          </span>
                        </div>
                        {board.overdue > 0 && (
                          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-destructive">
                            <CircleAlert className="size-3" />
                            {board.overdue} overdue
                          </p>
                        )}
                      </Link>
                    );
                  })}
                  <NewBoardButton
                    label="Create another board"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-auto w-fit justify-start gap-1.5 px-0 text-[11.5px] font-medium text-primary hover:bg-transparent hover:underline"
                  />
                </CardContent>
              </Card>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Card className="animate-rise" style={{ animationDelay: "100ms" }}>
                <CardHeader className="pb-1">
                  <PageSectionTitle>Workload by priority</PageSectionTitle>
                  <p className="-mt-2 text-[12px] text-muted-foreground">
                    All {data.totals.tasks} tasks, including completed work.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  {(["urgent", "high", "medium", "low", "none"] as Priority[]).map(
                    (priority) => {
                      const count = data.priorityCounts[priority];
                      const width = Math.max(
                        count > 0 ? 6 : 0,
                        Math.round((count / maxPriority) * 100),
                      );
                      return (
                        <div key={priority} className="flex items-center gap-3">
                          <span className="w-16 shrink-0 text-[11.5px] text-muted-foreground">
                            {PRIORITY_META[priority].label}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                PRIORITY_COLORS[priority],
                              )}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-[11px] tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        </div>
                      );
                    },
                  )}
                </CardContent>
              </Card>

              <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
                <CardHeader className="pb-1">
                  <PageSectionTitle>Recent activity</PageSectionTitle>
                  <p className="-mt-2 text-[12px] text-muted-foreground">
                    Recent task and whiteboard updates across projects.
                  </p>
                </CardHeader>
                <CardContent className="pt-3">
                  {data.activity.length === 0 ? (
                    <EmptyState
                      icon={Sparkles}
                      title="No activity yet"
                      description="Create or update work to see it here."
                      compact
                    />
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {data.activity.slice(0, 6).map((item) => (
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
                            ) : (
                              <LayoutGrid className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px]">
                                {item.title}
                              </span>
                              <span className="block truncate text-[10.5px] text-muted-foreground">
                                {[item.projectName, item.boardName]
                                  .filter(Boolean)
                                  .join(" / ")}
                                {item.detail ? ` · ${item.detail}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {format(new Date(item.timestamp), "MMM d")}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </PageSurface>
  );
}

function OverviewSkeleton({
  projectCount,
  boardCount,
}: {
  projectCount: number;
  boardCount: number;
}) {
  const empty = projectCount === 0 && boardCount === 0;

  return (
    <div className="mx-auto w-full max-w-[1220px] px-5 py-8 sm:px-8 lg:py-10">
      <header>
        <Skeleton className="h-3 w-36" />
        <Skeleton className="mt-3 h-8 w-52 max-w-full" />
        <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />
      </header>

      {empty ? (
        <section className="mt-10">
          <div className="rounded-2xl border border-border/80 bg-card px-6 py-16 shadow-soft sm:px-12">
            <div className="mx-auto flex max-w-xl flex-col items-center text-center">
              <Skeleton className="size-14 rounded-2xl" />
              <Skeleton className="mt-5 h-7 w-80 max-w-full" />
              <Skeleton className="mt-3 h-3.5 w-full max-w-md" />
              <Skeleton className="mt-2 h-3.5 w-3/4 max-w-sm" />
              <Skeleton className="mt-6 h-9 w-48 rounded-lg" />
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="rounded-xl border border-border/70 bg-card p-5 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="size-7 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-7 w-12" />
                <Skeleton className="mt-3 h-2.5 w-32 max-w-full" />
              </div>
            ))}
          </section>

          {projectCount > 0 && (
            <section className="mt-5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: projectCount }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-border/70 bg-card p-4 shadow-soft"
                  >
                    <div className="flex items-start gap-2">
                      <Skeleton className="size-8 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-2.5 w-3/5" />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Skeleton className="h-2.5 w-16" />
                      <Skeleton className="h-2.5 w-20" />
                      <Skeleton className="ml-auto h-2.5 w-8" />
                    </div>
                    <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <OverviewCardSkeleton rows={3} />
            <OverviewCardSkeleton rows={Math.max(1, boardCount)} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <OverviewCardSkeleton rows={4} />
            <OverviewCardSkeleton rows={4} />
          </div>
        </>
      )}
    </div>
  );
}

function OverviewCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5 shadow-soft">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-48 max-w-full" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 py-1.5">
            <Skeleton className="size-2 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
            <Skeleton className="h-2.5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
  tone?: "default" | "warning" | "success";
  delay?: number;
}) {
  return (
    <Card
      className="animate-rise relative overflow-hidden"
      style={{ animationDelay: `${delay * 40}ms` }}
    >
      <div className="absolute top-4 right-4 grid size-7 place-items-center rounded-lg bg-muted/70 text-muted-foreground">
        <Icon className="size-3.5" />
      </div>
      <CardContent className="px-5 pt-5 pb-4">
        <p className="text-[11px] font-medium tracking-[0.01em] text-muted-foreground">
          {label}
        </p>
        <p className="font-display mt-2 text-[27px] leading-none font-semibold tabular-nums">
          {value}
        </p>
        <p
          className={cn(
            "mt-2 text-[10.5px]",
            tone === "warning"
              ? "text-destructive"
              : tone === "success"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}
