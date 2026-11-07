import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabaseBundle, getDb } from "@/db";
import { boards, projects } from "@/db/schema";
import { getLocalUser, LOCAL_USER_ID } from "@/lib/server/desktop";
import { LEGACY_WORKSPACE_ID } from "@/lib/server/legacy-workspace";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

let test: TestDatabase;

beforeAll(async () => {
  test = await createTestDatabase();
  process.env.DATABASE_URL = test.url;
  (globalThis as unknown as { __masarDatabase?: unknown }).__masarDatabase =
    undefined;
  getDb();
});

afterAll(async () => {
  await test.close();
});

describe("desktop local account reconciliation", () => {
  it("reassigns legacy projects and gives projectless boards a home", async () => {
    await test.db.insert(projects).values({
      id: "default-project-legacy-workspace",
      ownerId: LEGACY_WORKSPACE_ID,
      name: "General",
      archived: false,
    });
    await test.db.insert(boards).values([
      {
        id: "legacy-project-board",
        ownerId: LEGACY_WORKSPACE_ID,
        projectId: "default-project-legacy-workspace",
        name: "Existing",
      },
      {
        id: "projectless-board",
        ownerId: LEGACY_WORKSPACE_ID,
        name: "Projectless",
      },
    ]);

    const user = await getLocalUser();
    expect(user.id).toBe(LOCAL_USER_ID);

    const projectRows = await test.db.select().from(projects);
    expect(projectRows).toHaveLength(1);
    expect(projectRows[0]).toMatchObject({
      id: "default-project-legacy-workspace",
      ownerId: LOCAL_USER_ID,
      name: "General",
    });

    const boardRows = await test.db.select().from(boards);
    expect(boardRows).toHaveLength(2);
    expect(boardRows.every((board) => board.ownerId === LOCAL_USER_ID)).toBe(
      true,
    );
    expect(
      boardRows.every(
        (board) => board.projectId === "default-project-legacy-workspace",
      ),
    ).toBe(true);

    // Close the process-global database handle opened for this test file.
    getDatabaseBundle().client.close();
  });
});
