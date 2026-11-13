import { describe, expect, it } from "vitest";

import {
  buildProjectHierarchy,
  folderAncestors,
  folderPathLabel,
  folderSubtreeIds,
} from "@/lib/folder-tree";
import type { BoardSummary, FolderSummary } from "@/lib/types";

function folder(
  id: string,
  name: string,
  parentId: string | null,
  position = 0,
  projectId = "project-1",
): FolderSummary {
  return {
    id,
    projectId,
    parentId,
    name,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function board(
  id: string,
  name: string,
  folderId: string | null,
  position = 0,
  projectId = "project-1",
): BoardSummary {
  return {
    id,
    projectId,
    folderId,
    type: "kanban",
    name,
    description: null,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    taskCount: 0,
    doneCount: 0,
    columnCount: 0,
  };
}

describe("folder tree helpers", () => {
  it("groups nested folders and spaces while keeping root spaces separate", () => {
    const folders = [
      folder("parent", "Parent", null, 0),
      folder("child", "Child", "parent", 0),
      folder("sibling", "Sibling", null, 1),
    ];
    const boards = [
      board("root-space", "Root space", null),
      board("top-space", "Top space", "parent", 1),
      board("nested-space", "Nested space", "child", 0),
      board("sibling-space", "Sibling space", "sibling", 0),
      board("elsewhere", "Other project", null, 0, "project-2"),
    ];

    const hierarchy = buildProjectHierarchy("project-1", folders, boards);
    expect(hierarchy.folders.map((node) => node.folder.id)).toEqual([
      "parent",
      "sibling",
    ]);
    expect(hierarchy.boards.map((item) => item.id)).toEqual(["root-space"]);

    const parent = hierarchy.folders[0]!;
    expect(parent.folders.map((node) => node.folder.id)).toEqual(["child"]);
    expect(parent.boards.map((item) => item.id)).toEqual(["top-space"]);
    expect(parent.folders[0]?.boards.map((item) => item.id)).toEqual([
      "nested-space",
    ]);
    expect(hierarchy.folders[1]?.boards.map((item) => item.id)).toEqual([
      "sibling-space",
    ]);
  });

  it("recovers orphaned and cyclic folders instead of hiding their spaces", () => {
    const folders = [
      folder("orphan", "Orphan", "missing", 0),
      folder("cycle-a", "Cycle A", "cycle-b"),
      folder("cycle-b", "Cycle B", "cycle-a"),
    ];
    const boards = [
      board("orphan-space", "Orphan space", "orphan"),
      board("cycle-space", "Cycle space", "cycle-a"),
    ];

    const hierarchy = buildProjectHierarchy("project-1", folders, boards);
    const flattened = new Set<string>();
    const walk = (nodes: typeof hierarchy.folders) => {
      for (const node of nodes) {
        expect(flattened.has(node.folder.id)).toBe(false);
        flattened.add(node.folder.id);
        walk(node.folders);
        for (const item of node.boards) {
          expect(item.folderId).toBe(node.folder.id);
        }
      }
    };
    walk(hierarchy.folders);

    expect(flattened).toEqual(new Set(["orphan", "cycle-a", "cycle-b"]));
    expect(hierarchy.folders.find((node) => node.folder.id === "orphan")?.boards)
      .toHaveLength(1);
    expect(
      hierarchy.folders.find((node) => node.folder.id === "cycle-a")?.boards,
    ).toHaveLength(1);
  });

  it("builds readable paths and subtree ids for move dialogs", () => {
    const folders = [
      folder("parent", "Marketing", null),
      folder("child", "Q3", "parent"),
      folder("grandchild", "Launch", "child"),
      folder("other", "Other", null),
    ];

    expect(folderPathLabel(folders, null)).toBe("Project root");
    expect(folderPathLabel(folders, "grandchild")).toBe(
      "Marketing / Q3 / Launch",
    );
    expect(
      folderAncestors(folders, "grandchild").map((item) => item.id),
    ).toEqual(["child", "parent"]);
    expect(folderSubtreeIds(folders, "parent")).toEqual(
      new Set(["parent", "child", "grandchild"]),
    );
    expect(folderSubtreeIds(folders, "other")).toEqual(new Set(["other"]));
  });
});
