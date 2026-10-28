import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
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
    const user = await requireApiUser();
    const { taskId } = await params;
    const task = await getTaskDetail(taskId, user.id);
    return jsonOk({ task });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { taskId } = await params;
    const input = await parseJsonBody(request, taskUpdateSchema);
    const task = await updateTask(taskId, input, user.id);
    return jsonOk({ task });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { taskId } = await params;
    await deleteTask(taskId, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
