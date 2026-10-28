import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { reorderTasksSchema } from "@/lib/validation";
import { reorderTasks } from "@/lib/server/tasks";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    const input = await parseJsonBody(request, reorderTasksSchema);
    const tasks = await reorderTasks(boardId, input, user.id);
    return jsonOk({ tasks });
  } catch (error) {
    return handleRouteError(error);
  }
}
