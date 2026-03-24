import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { subtaskUpdateSchema } from "@/lib/validation";
import { deleteSubtask, updateSubtask } from "@/lib/server/subtasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subtaskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { subtaskId } = await params;
    const input = await parseJsonBody(request, subtaskUpdateSchema);
    const subtask = await updateSubtask(subtaskId, input);
    return jsonOk({ subtask });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { subtaskId } = await params;
    await deleteSubtask(subtaskId);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
