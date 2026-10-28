import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().run(sql`select 1`);
    return Response.json({ status: "ok", database: "connected" });
  } catch (error) {
    return handleRouteError(error);
  }
}
