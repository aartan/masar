import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { reorderColumnsSchema } from "@/lib/validation";
import { reorderColumns } from "@/lib/server/columns";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    const input = await parseJsonBody(request, reorderColumnsSchema);
    const columns = await reorderColumns(boardId, input.columnIds, user.id);
    return jsonOk({ columns });
  } catch (error) {
    return handleRouteError(error);
  }
}
