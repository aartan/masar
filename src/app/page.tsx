import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Layers,
  ListTodo,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";

import { getDashboardData } from "@/lib/server/stats";
import { todayIso } from "@/lib/dates";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { completionPercent } from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DueDateChip, PriorityBars } from "@/components/shared/task-meta";
import { BOARD_COLOR_CLASS } from "@/components/shared/colors";
import { EmptyState, PageSectionTitle } from "@/components/shared/empty-state";
import { NewBoardButton } from "@/components/board/new-board-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview",
};

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

export default async function OverviewPage() {
  const data = await getDashboardData();
  const today = todayIso();
  const completion = completionPercent(data.totals.done, data.totals.tasks);
  const maxPriority = Math.max(
    1,
    ...Object.values(data.priorityCounts),
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1220px] px-5 py-8 sm:px-8 lg:py-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="animate-rise">
            <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
            <h1 className="font-display mt-2 text-[28px] leading-tight font-semibold text-foreground sm:text-[32px]">
              {greeting()}.
            </h1>
            <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-muted-foreground">
              {data.totals.boards > 0
                ? `A calm view of ${data.totals.boards} ${data.totals.boards === 1 ? "board" : "boards"} and ${data.totals.open} open ${data.totals.open === 1 ? "task" : "tasks"}.`
                : "Your workspace is ready for its first board."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.totals.boards > 0 && (
              <Link
                href={`/boards/${data.boardStats[0]?.boardId ?? ""}`}
                className="group inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card/60 px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/60"
              >
                Open a board
                <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            )}
            <NewBoardButton />
          </div>
        </header>

        {data.totals.boards === 0 ? (
          <section className="mt-10 animate-rise">
            <div className="dot-grid relative overflow-hidden rounded-2xl border border-border/80 bg-card px-6 py-16 shadow-soft sm:px-12">
              <div className="absolute -top-24 -right-16 size-64 rounded-full bg-primary/6 blur-3xl" />
              <div className="relative mx-auto max-w-xl text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="size-6" strokeWidth={1.6} />
                </span>
                <h2 className="font-display mt-5 text-2xl font-semibold">
                  A calmer way to ship.
                </h2>
                <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                  Create a board, add a few tasks, and let the work find its own
                  rhythm. Five thoughtful columns are waiting for you.
                </p>
                <div className="mt-6 flex justify-center">
                  <NewBoardButton label="Create your first board" size="lg" />
                </div>
                <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                  {[
                    ["Board", "Structure the work"],
                    ["Flow", "Drag without friction"],
                    ["Focus", "See what matters"],
                  ].map(([title, subtitle]) => (
                    <div
                      key={title}
                      className="rounded-lg border border-border/60 bg-background/50 px-3.5 py-3"
                    >
                      <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground/60 uppercase">
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

            <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
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
                            href={`/boards/${task.boardId}?task=${task.id}`}
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
                                <span className="text-muted-foreground/40">
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
                        href={`/boards/${board.boardId}`}
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
                          <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground/70">
                            {percent}%
                          </span>
                        </div>
                        {board.overdue > 0 && (
                          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-rose-600 dark:text-rose-400">
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
                  <PageSectionTitle>Recently added</PageSectionTitle>
                  <p className="-mt-2 text-[12px] text-muted-foreground">
                    The newest work across every board.
                  </p>
                </CardHeader>
                <CardContent className="pt-3">
                  {data.recent.length === 0 ? (
                    <EmptyState
                      icon={Sparkles}
                      title="No tasks yet"
                      description="Create a task on any board to get started."
                      compact
                    />
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {data.recent.slice(0, 5).map((task) => (
                        <li key={task.id}>
                          <Link
                            href={`/boards/${task.boardId}?task=${task.id}`}
                            className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
                          >
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                BOARD_COLOR_CLASS[task.boardColor],
                                "board-dot",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-[12.5px]">
                              {task.title}
                            </span>
                            <span className="shrink-0 text-[10.5px] text-muted-foreground">
                              {task.boardName}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <p className="mt-8 flex items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground/50">
              <span className="size-1 rounded-full bg-emerald-500" />
              Data is stored in your workspace database · {today}
            </p>
          </>
        )}
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
              ? "text-rose-600 dark:text-rose-400"
              : tone === "success"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground/70",
          )}
        >
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}
