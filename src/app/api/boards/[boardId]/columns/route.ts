import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { columnCreateSchema } from "@/lib/validation";
import { createColumn } from "@/lib/server/columns";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const { boardId } = await params;
    const input = await parseJsonBody(request, columnCreateSchema);
    const column = await createColumn(boardId, input);
    return jsonOk({ column }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
