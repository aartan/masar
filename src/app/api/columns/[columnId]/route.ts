import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { columnUpdateSchema } from "@/lib/validation";
import { deleteColumn, updateColumn } from "@/lib/server/columns";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ columnId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { columnId } = await params;
    const input = await parseJsonBody(request, columnUpdateSchema);
    const column = await updateColumn(columnId, input);
    return jsonOk({ column });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { columnId } = await params;
    const result = await deleteColumn(columnId);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
