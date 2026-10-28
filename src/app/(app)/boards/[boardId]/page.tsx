import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BoardView } from "@/components/board/board-view";
import { ApiError } from "@/lib/api";
import { getCurrentUser, requireUser } from "@/lib/server/auth";
import { getBoardDetail } from "@/lib/server/boards";

export const dynamic = "force-dynamic";

const loadBoard = cache(async (boardId: string, ownerId: string) =>
  getBoardDetail(boardId, ownerId),
);

async function findBoard(boardId: string, ownerId: string) {
  try {
    return await loadBoard(boardId, ownerId);
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
  const [{ boardId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) return { title: "Board" };

  try {
    const board = await loadBoard(boardId, user.id);
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
  const user = await requireUser();
  const [{ boardId }, query] = await Promise.all([params, searchParams]);
  const data = await findBoard(boardId, user.id);
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
