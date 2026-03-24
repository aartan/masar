import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { labelCreateSchema } from "@/lib/validation";
import { createLabel } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const { boardId } = await params;
    const input = await parseJsonBody(request, labelCreateSchema);
    const label = await createLabel(boardId, input);
    return jsonOk({ label }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
