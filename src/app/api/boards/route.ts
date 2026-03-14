import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { boardCreateSchema } from "@/lib/validation";
import { createBoard, listBoards } from "@/lib/server/boards";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const boards = await listBoards();
    return jsonOk({ boards });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, boardCreateSchema);
    const board = await createBoard(input);
    return jsonOk({ board }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
