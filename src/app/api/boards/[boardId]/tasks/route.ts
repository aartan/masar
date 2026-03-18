import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { taskCreateSchema } from "@/lib/validation";
import { createTask } from "@/lib/server/tasks";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const { boardId } = await params;
    const input = await parseJsonBody(request, taskCreateSchema);
    const task = await createTask(boardId, input);
    return jsonOk({ task }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
