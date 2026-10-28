import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { labelCreateSchema } from "@/lib/validation";
import { createLabel } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    const user = await requireApiUser();
    const { boardId } = await params;
    const input = await parseJsonBody(request, labelCreateSchema);
    const label = await createLabel(boardId, input, user.id);
    return jsonOk({ label }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
