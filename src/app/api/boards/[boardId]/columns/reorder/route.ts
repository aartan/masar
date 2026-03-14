import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { reorderColumnsSchema } from "@/lib/validation";
import { reorderColumns } from "@/lib/server/columns";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const { boardId } = await params;
    const input = await parseJsonBody(request, reorderColumnsSchema);
    const columns = await reorderColumns(boardId, input.columnIds);
    return jsonOk({ columns });
  } catch (error) {
    return handleRouteError(error);
  }
}
