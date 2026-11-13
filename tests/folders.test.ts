import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { boards, projects } from "@/db/schema";
import {
  createBoard,
  listBoards,
  moveBoard,
} from "@/lib/server/boards";
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  updateFolder,
} from "@/lib/server/folders";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectDetail,
} from "@/lib/server/projects";
import type { TestDatabase } from "./helpers/test-db";
import { createTestDatabase, createTestUser } from "./helpers/test-db";

let test: TestDatabase;
let owner: { id: string; name: string; email: string };
let other: { id: string; name: string; email: string };

beforeAll(async () => {
  test = await createTestDatabase();
  owner = await createTestUser(test.db, {
    name: "Folder owner",
    email: "folder-owner@example.test",
  });
  other = await createTestUser(test.db, {
    name: "Other",
    email: "folder-other@example.test",
  });
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.db.delete(boards);
  await test.db.delete(projects);
});

async function makeProject(name = "Project") {
  return createProject({ name }, owner.id, test.db);
}

describe("folders", () => {
  it("creates a recursive tree and assigns spaces to folders", async () => {
    const project = await makeProject();
    const marketing = await createFolder(
      { projectId: project.id, name: "Marketing" },
      owner.id,
      test.db,
    );
    const q3 = await createFolder(
      { projectId: project.id, parentId: marketing.id, name: "Q3" },
      owner.id,
      test.db,
    );
    const rootSpace = await createBoard(
      { name: "Root space", projectId: project.id },
      owner.id,
      test.db,
    );
    const folderSpace = await createBoard(
      { name: "Folder space", projectId: project.id, folderId: q3.id },
      owner.id,
      test.db,
    );

    expect(marketing.parentId).toBeNull();
    expect(q3.parentId).toBe(marketing.id);
    expect(rootSpace.folderId).toBeNull();
    expect(folderSpace.folderId).toBe(q3.id);
    expect(folderSpace.position).toBe(0);

    const detail = await getProjectDetail(project.id, owner.id, test.db);
    expect(detail.folders.map((folder) => folder.name).sort()).toEqual([
      "Marketing",
      "Q3",
    ]);
    expect(
      detail.boards.find((board) => board.id === folderSpace.id)?.folderId,
    ).toBe(q3.id);
  });

  it("re-parents and reorders folders without allowing cycles", async () => {
    const project = await makeProject();
    const alpha = await createFolder(
      { projectId: project.id, name: "Alpha" },
      owner.id,
      test.db,
    );
    const beta = await createFolder(
      { projectId: project.id, name: "Beta" },
      owner.id,
      test.db,
    );
    const child = await createFolder(
      { projectId: project.id, parentId: alpha.id, name: "Child" },
      owner.id,
      test.db,
    );

    await moveFolder(
      beta.id,
      { parentId: alpha.id, index: 0 },
      owner.id,
      test.db,
    );
    let folders = await listFolders(owner.id, test.db);
    const betaMoved = folders.find((folder) => folder.id === beta.id)!;
    expect(betaMoved.parentId).toBe(alpha.id);
    expect(betaMoved.position).toBe(0);
    expect(
      folders.find((folder) => folder.id === child.id)?.position,
    ).toBe(1);

    await expect(
      moveFolder(alpha.id, { parentId: child.id, index: 0 }, owner.id, test.db),
    ).rejects.toThrow(/own subfolder/i);
    await expect(
      moveFolder(alpha.id, { parentId: alpha.id, index: 0 }, owner.id, test.db),
    ).rejects.toThrow(/inside itself/i);

    await moveFolder(child.id, { parentId: null, index: 0 }, owner.id, test.db);
    folders = await listFolders(owner.id, test.db);
    expect(folders.find((folder) => folder.id === child.id)).toMatchObject({
      parentId: null,
      position: 0,
    });
  });

  it("moves spaces into folders and back to the project root", async () => {
    const project = await makeProject();
    const folder = await createFolder(
      { projectId: project.id, name: "Folder" },
      owner.id,
      test.db,
    );
    const first = await createBoard(
      { name: "First", projectId: project.id },
      owner.id,
      test.db,
    );
    const second = await createBoard(
      { name: "Second", projectId: project.id },
      owner.id,
      test.db,
    );

    await moveBoard(
      { projectId: project.id, folderId: folder.id, boardIds: [first.id] },
      owner.id,
      test.db,
    );
    let all = await listBoards(owner.id, test.db);
    expect(all.find((board) => board.id === first.id)).toMatchObject({
      projectId: project.id,
      folderId: folder.id,
      position: 0,
    });

    await moveBoard(
      {
        projectId: project.id,
        folderId: null,
        boardIds: [first.id, second.id],
      },
      owner.id,
      test.db,
    );
    all = await listBoards(owner.id, test.db);
    expect(all.find((board) => board.id === first.id)).toMatchObject({
      folderId: null,
      position: 0,
    });
    expect(all.find((board) => board.id === second.id)).toMatchObject({
      folderId: null,
      position: 1,
    });
  });

  it("deletes a folder by promoting its child folders and spaces", async () => {
    const project = await makeProject();
    const existing = await createFolder(
      { projectId: project.id, name: "Existing" },
      owner.id,
      test.db,
    );
    const doomed = await createFolder(
      { projectId: project.id, name: "Doomed" },
      owner.id,
      test.db,
    );
    const child = await createFolder(
      { projectId: project.id, parentId: doomed.id, name: "Child" },
      owner.id,
      test.db,
    );
    const space = await createBoard(
      { name: "Kept space", projectId: project.id, folderId: doomed.id },
      owner.id,
      test.db,
    );

    await deleteFolder(doomed.id, owner.id, test.db);

    const folders = await listFolders(owner.id, test.db);
    expect(folders.some((folder) => folder.id === doomed.id)).toBe(false);
    expect(folders.find((folder) => folder.id === existing.id)?.position).toBe(
      0,
    );
    expect(folders.find((folder) => folder.id === child.id)).toMatchObject({
      parentId: null,
      position: 1,
    });
    const all = await listBoards(owner.id, test.db);
    expect(all.find((board) => board.id === space.id)).toMatchObject({
      folderId: null,
      position: 0,
    });
  });

  it("renames folders and refuses cross-project parents", async () => {
    const project = await makeProject("First project");
    const otherProject = await makeProject("Second project");
    const folder = await createFolder(
      { projectId: project.id, name: "Original" },
      owner.id,
      test.db,
    );
    const otherFolder = await createFolder(
      { projectId: otherProject.id, name: "Elsewhere" },
      owner.id,
      test.db,
    );

    const renamed = await updateFolder(
      folder.id,
      { name: "Renamed" },
      owner.id,
      test.db,
    );
    expect(renamed.name).toBe("Renamed");

    await expect(
      moveFolder(
        folder.id,
        { parentId: otherFolder.id, index: 0 },
        owner.id,
        test.db,
      ),
    ).rejects.toThrow(/between projects/i);
  });

  it("deletes a project's folder tree and spaces together", async () => {
    const project = await makeProject("With folders");
    const parent = await createFolder(
      { projectId: project.id, name: "Parent" },
      owner.id,
      test.db,
    );
    const child = await createFolder(
      { projectId: project.id, parentId: parent.id, name: "Child" },
      owner.id,
      test.db,
    );
    await createBoard(
      { name: "Nested space", projectId: project.id, folderId: child.id },
      owner.id,
      test.db,
    );

    await archiveProject(project.id, owner.id, test.db);
    await deleteProject(project.id, owner.id, project.name, test.db);

    expect(await listFolders(owner.id, test.db)).toHaveLength(0);
    expect(await listBoards(owner.id, test.db)).toHaveLength(0);
  });

  it("keeps archived projects read-only and scopes folders to their owner", async () => {
    const project = await makeProject();
    const folder = await createFolder(
      { projectId: project.id, name: "Locked" },
      owner.id,
      test.db,
    );
    await archiveProject(project.id, owner.id, test.db);

    await expect(
      createFolder(
        { projectId: project.id, name: "Nope" },
        owner.id,
        test.db,
      ),
    ).rejects.toThrow(/archived/i);
    await expect(
      updateFolder(folder.id, { name: "Nope" }, owner.id, test.db),
    ).rejects.toThrow(/archived/i);
    await expect(
      deleteFolder(folder.id, owner.id, test.db),
    ).rejects.toThrow(/archived/i);

    await expect(
      createFolder(
        { projectId: project.id, name: "Wrong owner" },
        other.id,
        test.db,
      ),
    ).rejects.toThrow(/not found/i);
    await expect(
      updateFolder(folder.id, { name: "Wrong owner" }, other.id, test.db),
    ).rejects.toThrow(/not found/i);
  });
});
