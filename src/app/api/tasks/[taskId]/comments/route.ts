import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { commentCreateSchema } from "@/lib/validation";
import { createComment } from "@/lib/server/comments";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const input = await parseJsonBody(request, commentCreateSchema);
    const comment = await createComment(taskId, input);
    return jsonOk({ comment }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
