import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { taskUpdateSchema } from "@/lib/validation";
import {
  deleteTask,
  getTaskDetail,
  updateTask,
} from "@/lib/server/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { taskId } = await params;
    const task = await getTaskDetail(taskId);
    return jsonOk({ task });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { taskId } = await params;
    const input = await parseJsonBody(request, taskUpdateSchema);
    const task = await updateTask(taskId, input);
    return jsonOk({ task });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { taskId } = await params;
    await deleteTask(taskId);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
