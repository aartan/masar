import { handleRouteError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/server/auth";
import { searchTasks } from "@/lib/server/search";
import { searchQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const input = searchQuerySchema.parse({
      q: searchParams.get("q") ?? "",
    });
    const results = await searchTasks(user.id, input.q);
    return jsonOk({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
