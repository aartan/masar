import { handleRouteError, jsonOk } from "@/lib/api";
import { deleteComment } from "@/lib/server/comments";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    const { commentId } = await params;
    await deleteComment(commentId);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
