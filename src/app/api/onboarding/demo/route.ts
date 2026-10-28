import { handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { addDemoWorkspace } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireApiUser();
    const board = await addDemoWorkspace(user.id);
    return jsonOk({ board }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
