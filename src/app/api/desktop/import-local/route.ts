import { handleRouteError, jsonOk, parseJsonBody } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { importWorkspacePayload, workspacePayloadSchema } from "@/lib/server/desktop-import";

export const dynamic = "force-dynamic";

/**
 * Import a desktop local workspace into the signed-in account. The desktop app
 * (sync mode) reads its local database and POSTs the contents here; the server
 * creates the boards and their children owned by the current user.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = await parseJsonBody(request, workspacePayloadSchema);
    const result = await importWorkspacePayload(user.id, payload);
    return jsonOk(result, 200);
  } catch (error) {
    return handleRouteError(error);
  }
}
