import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { subtaskCreateSchema } from "@/lib/validation";
import { createSubtask } from "@/lib/server/subtasks";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { taskId } = await params;
    const input = await parseJsonBody(request, subtaskCreateSchema);
    const subtask = await createSubtask(taskId, input.title, user.id);
    return jsonOk({ subtask }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
