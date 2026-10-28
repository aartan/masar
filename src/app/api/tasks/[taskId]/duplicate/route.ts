import { handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { duplicateTask } from "@/lib/server/tasks";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { taskId } = await params;
    const task = await duplicateTask(taskId, user.id);
    return jsonOk({ task }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
