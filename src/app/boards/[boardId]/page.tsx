import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BoardView } from "@/components/board/board-view";
import { ApiError } from "@/lib/api";
import { getBoardDetail } from "@/lib/server/boards";

export const dynamic = "force-dynamic";

const loadBoard = cache(async (boardId: string) => getBoardDetail(boardId));

async function findBoard(boardId: string) {
  try {
    return await loadBoard(boardId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ boardId: string }>;
}): Promise<Metadata> {
  const { boardId } = await params;
  try {
    const board = await loadBoard(boardId);
    return {
      title: board.board.name,
      description:
        board.board.description ??
        `${board.tasks.length} tasks across ${board.columns.length} columns.`,
    };
  } catch {
    return { title: "Board" };
  }
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const [{ boardId }, query] = await Promise.all([params, searchParams]);
  const data = await findBoard(boardId);
  const requestedTask = Array.isArray(query.task) ? query.task[0] : query.task;
  const initialTaskId =
    requestedTask && data.tasks.some((task) => task.id === requestedTask)
      ? requestedTask
      : undefined;

  return (
    <BoardView
      key={`${boardId}:${initialTaskId ?? ""}`}
      initialData={data}
      initialTaskId={initialTaskId}
    />
  );
}
