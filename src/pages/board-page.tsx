import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { BoardView } from "@/components/board/board-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import type { BoardDetail } from "@/lib/types";

// Excalidraw is heavy; load the whiteboard view only when a whiteboard board
// is opened so it never enters the Kanban bundle.
const WhiteboardView = React.lazy(() =>
  import("@/components/whiteboard/whiteboard-view").then((module) => ({
    default: module.WhiteboardView,
  })),
);

export function BoardPage() {
  const { boardId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = React.useState<BoardDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

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
          setError(caught instanceof Error ? caught.message : "Could not load this board.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [boardId]);

  if (loading) {
    return (
      <div className="flex h-full flex-col bg-canvas">
        <div className="border-b border-border/60 bg-background/65 px-4 py-5 sm:px-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-7 w-64" />
          <Skeleton className="mt-3 h-3 w-52" />
        </div>
        <div className="flex gap-3 px-4 py-4 sm:px-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-[280px] shrink-0 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-semibold">Board not found</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error ?? "This board may have been deleted or does not belong to this workspace."}
          </p>
          <Button asChild className="mt-5">
            <Link to="/">Back to overview</Link>
          </Button>
        </div>
      </div>
    );
  }

  const requestedTask = searchParams.get("task") ?? undefined;
  const initialTaskId =
    requestedTask && data.tasks.some((task) => task.id === requestedTask)
      ? requestedTask
      : undefined;

  if (data.board.type === "whiteboard") {
    return (
      <React.Suspense
        fallback={
          <div className="flex h-full flex-col bg-canvas">
            <div className="border-b border-border/60 bg-background/65 px-4 py-5 sm:px-6">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-3 h-7 w-64" />
            </div>
            <div className="flex-1 p-4 sm:p-6">
              <Skeleton className="h-full min-h-[420px] w-full rounded-2xl" />
            </div>
          </div>
        }
      >
        <WhiteboardView key={boardId} board={data.board} />
      </React.Suspense>
    );
  }

  return (
    <BoardView
      key={`${boardId}:${initialTaskId ?? ""}`}
      initialData={data}
      initialTaskId={initialTaskId}
    />
  );
}
