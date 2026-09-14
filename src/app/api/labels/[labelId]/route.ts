import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { labelUpdateSchema } from "@/lib/validation";
import { deleteLabel, updateLabel } from "@/lib/server/labels";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ labelId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { labelId } = await params;
    const input = await parseJsonBody(request, labelUpdateSchema);
    const label = await updateLabel(labelId, input, user.id);
    return jsonOk({ label });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { labelId } = await params;
    await deleteLabel(labelId, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
