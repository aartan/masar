import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { BoardView } from "@/components/board/board-view";
import { PageSkeleton, PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { BoardDetail } from "@/lib/types";

// Excalidraw is heavy; load the whiteboard view only when a whiteboard board
// is opened so it never enters the Kanban bundle. BlockNote is the same: the
// note view is chunked out and loaded only when a note space is opened.
const WhiteboardView = React.lazy(() =>
  import("@/components/whiteboard/whiteboard-view").then((module) => ({
    default: module.WhiteboardView,
  })),
);

const NoteView = React.lazy(() =>
  import("@/components/note/note-view").then((module) => ({
    default: module.NoteView,
  })),
);

export function BoardPage() {
  const { boardId = "" } = useParams();
  const { boards, projects } = useWorkspace();
  const boardSummary = boards.find((board) => board.id === boardId);
  const [searchParams] = useSearchParams();
  const [data, setData] = React.useState<BoardDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const showSkeleton = useDelayedLoading(loading);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api<{ board: BoardDetail }>(`/api/boards/${boardId}`)
      .then((result) => {
        if (active) setData(result.board);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load this space.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [boardId]);

  useOnSyncComplete(() => {
    void api<{ board: BoardDetail }>(`/api/boards/${boardId}`)
      .then((result) => {
        setData(result.board);
        setError(null);
        setRefreshToken((value) => value + 1);
      })
      .catch(() => {
        /* A background refresh should not replace a usable board with an error. */
      });
  });

  if (loading) {
    if (!showSkeleton) {
      return <div className="h-full" aria-busy="true" />;
    }
    return (
      <PageSkeleton label="Loading space">
        {boardSummary?.type === "whiteboard" ? (
          <WhiteboardSkeleton />
        ) : boardSummary?.type === "note" ? (
          <NoteSkeleton />
        ) : (
          <BoardSkeleton columnCount={boardSummary?.columnCount ?? 5} />
        )}
      </PageSkeleton>
    );
  }

  if (error || !data) {
    return (
      <PageSurface className="grid h-full place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-semibold">Space not found</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error ?? "This space may have been deleted or does not belong to this workspace."}
          </p>
          <Button asChild className="mt-5">
            <Link to="/">Back to overview</Link>
          </Button>
        </div>
      </PageSurface>
    );
  }

  const requestedTask = searchParams.get("task") ?? undefined;
  const initialTaskId =
    requestedTask && data.tasks.some((task) => task.id === requestedTask)
      ? requestedTask
      : undefined;
  const readOnly =
    projects.find((project) => project.id === data.board.projectId)?.archived ??
    false;

  if (data.board.type === "whiteboard") {
    return (
      <React.Suspense
        fallback={
          <PageSkeleton label="Loading whiteboard">
            <WhiteboardSkeleton />
          </PageSkeleton>
        }
      >
        <WhiteboardView key={boardId} board={data.board} />
      </React.Suspense>
    );
  }

  if (data.board.type === "note") {
    return (
      <React.Suspense
        fallback={
          <PageSkeleton label="Loading note">
            <NoteSkeleton />
          </PageSkeleton>
        }
      >
        <NoteView key={boardId} board={data.board} />
      </React.Suspense>
    );
  }

  return (
    <BoardView
      key={`${boardId}:${initialTaskId ?? ""}`}
      initialData={data}
      initialTaskId={initialTaskId}
      readOnly={readOnly}
      refreshToken={refreshToken}
    />
  );
}

function BoardSkeleton({ columnCount }: { columnCount: number }) {
  const columns = Math.max(2, columnCount);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 bg-background/65">
        <div className="px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-h-4 items-center gap-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-2" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <div className="mt-2 flex min-h-[58px] flex-wrap items-start gap-x-3 gap-y-3">
            <Skeleton className="mt-2 size-2.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-7 w-48 max-w-full" />
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="hidden h-8 w-28 rounded-lg sm:block" />
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
          </div>
        </div>
        <div className="px-4 pt-3 pb-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-52 max-w-full rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="ml-auto h-8 w-28 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="scrollbar-thin flex h-full snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 py-4 sm:snap-none sm:px-6">
          {Array.from({ length: columns }).map((_, index) => (
            <div
              key={index}
              className="flex h-full w-[84vw] max-w-[316px] shrink-0 snap-start flex-col rounded-2xl border border-border/60 bg-muted/35 p-2 dark:border-border dark:bg-muted/20 sm:w-[300px]"
            >
              <div className="flex items-center gap-2 px-0.5 pt-0.5 pb-1.5">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="ml-auto h-3 w-5" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 px-0.5 pt-1">
                {Array.from({ length: index === 0 ? 2 : 1 }).map((_, card) => (
                  <div
                    key={card}
                    className="rounded-xl border border-border/70 bg-card p-3 shadow-soft"
                  >
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="mt-2 h-2.5 w-3/5" />
                    <div className="mt-3 flex items-center gap-2">
                      <Skeleton className="h-2.5 w-12" />
                      <Skeleton className="ml-auto h-2.5 w-8" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-2 px-0.5 pb-1">
                <Skeleton className="size-3 rounded" />
                <Skeleton className="h-2.5 w-14" />
              </div>
            </div>
          ))}
          <Skeleton className="mt-0 h-10 w-[220px] shrink-0 self-start rounded-xl border border-dashed border-border/80" />
        </div>
      </div>
    </div>
  );
}

function WhiteboardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 bg-background/65 px-4 py-3 sm:px-6">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-40 max-w-[40%]" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-6 w-14 rounded" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border/60 bg-muted/15">
          <div className="absolute top-4 left-4 flex flex-col gap-1.5 rounded-xl border border-border/70 bg-card p-1.5 shadow-soft">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="size-7 rounded-lg" />
            ))}
          </div>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-xl border border-border/70 bg-card p-1.5 shadow-soft">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="size-7 rounded-lg" />
            ))}
          </div>
          <Skeleton className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function NoteSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/60 bg-background/65 px-4 py-3 sm:px-6">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-40 max-w-[40%]" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-6 w-14 rounded" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 py-8 sm:px-8 sm:py-12">
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-8 h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </div>
      </div>
    </div>
  );
}
