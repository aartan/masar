import { handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { deleteComment } from "@/lib/server/comments";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { commentId } = await params;
    await deleteComment(commentId, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
