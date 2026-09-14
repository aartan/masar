import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { boardCreateSchema } from "@/lib/validation";
import { requireApiUser } from "@/lib/server/auth";
import { createBoard, listBoards } from "@/lib/server/boards";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const boards = await listBoards(user.id);
    return jsonOk({ boards });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = await parseJsonBody(request, boardCreateSchema);
    const board = await createBoard(input, user.id);
    return jsonOk({ board }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
