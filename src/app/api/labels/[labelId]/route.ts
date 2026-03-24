import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { labelUpdateSchema } from "@/lib/validation";
import { deleteLabel, updateLabel } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ labelId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { labelId } = await params;
    const input = await parseJsonBody(request, labelUpdateSchema);
    const label = await updateLabel(labelId, input);
    return jsonOk({ label });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { labelId } = await params;
    await deleteLabel(labelId);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
