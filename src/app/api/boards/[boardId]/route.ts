import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { boardUpdateSchema } from "@/lib/validation";
import {
  deleteBoard,
  getBoardDetail,
  updateBoard,
} from "@/lib/server/boards";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ boardId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    const board = await getBoardDetail(boardId, user.id);
    return jsonOk({ board });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    const input = await parseJsonBody(request, boardUpdateSchema);
    const board = await updateBoard(boardId, input, user.id);
    return jsonOk({ board });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    await deleteBoard(boardId, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
