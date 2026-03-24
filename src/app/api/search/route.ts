import { handleRouteError, jsonOk } from "@/lib/api";
import { searchTasks } from "@/lib/server/search";
import { searchQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = searchQuerySchema.parse({
      q: searchParams.get("q") ?? "",
    });
    const results = await searchTasks(input.q);
    return jsonOk({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
