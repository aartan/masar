import type { BoardSummary, FolderSummary } from "@/lib/types";

/**
 * A folder with its direct children already resolved. The tree is built from
 * flat lists so the same shape can serve the sidebar, the project overview,
 * and keyboard-accessible move dialogs.
 */
export interface FolderTreeNode {
  folder: FolderSummary;
  folders: FolderTreeNode[];
  boards: BoardSummary[];
}

export interface ProjectHierarchy {
  /** Root-level folders, ordered by position. */
  folders: FolderTreeNode[];
  /** Spaces that live directly in the project root. */
  boards: BoardSummary[];
}

function comparePosition(
  a: { position: number; createdAt: string },
  b: { position: number; createdAt: string },
): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Build the optional folder tree for a project. Folders are always rendered
 * before spaces in a container, so ordering is stable even after moves.
 *
 * Defensive handling keeps corrupt sync data visible: a folder whose parent is
 * missing or belongs to another project becomes a root folder, and a cyclic
 * parent chain is broken rather than recursing forever.
 */
export function buildProjectHierarchy(
  projectId: string,
  folders: FolderSummary[],
  boards: BoardSummary[],
): ProjectHierarchy {
  const projectFolders = folders
    .filter((folder) => folder.projectId === projectId)
    .sort(comparePosition);
  const foldersById = new Map(
    projectFolders.map((folder) => [folder.id, folder]),
  );

  const childFolders = new Map<string | null, FolderSummary[]>();
  for (const folder of projectFolders) {
    const parentId =
      folder.parentId && foldersById.has(folder.parentId)
        ? folder.parentId
        : null;
    const list = childFolders.get(parentId) ?? [];
    list.push(folder);
    childFolders.set(parentId, list);
  }

  const projectBoards = boards
    .filter((board) => board.projectId === projectId)
    .sort(comparePosition);
  const boardsByFolder = new Map<string | null, BoardSummary[]>();
  for (const board of projectBoards) {
    const container =
      board.folderId && foldersById.has(board.folderId)
        ? board.folderId
        : null;
    const list = boardsByFolder.get(container) ?? [];
    list.push(board);
    boardsByFolder.set(container, list);
  }

  const visited = new Set<string>();
  function buildNode(folder: FolderSummary): FolderTreeNode {
    visited.add(folder.id);
    const children = childFolders.get(folder.id) ?? [];
    return {
      folder,
      folders: children
        .filter((child) => !visited.has(child.id))
        .map((child) => buildNode(child)),
      boards: boardsByFolder.get(folder.id) ?? [],
    };
  }

  const roots = (childFolders.get(null) ?? [])
    .filter((folder) => !visited.has(folder.id))
    .map((folder) => buildNode(folder));

  // Cycle recovery: any folder not reachable from a root is appended as its
  // own root so its spaces never disappear from the hierarchy.
  for (const folder of projectFolders) {
    if (!visited.has(folder.id)) roots.push(buildNode(folder));
  }

  return {
    folders: roots,
    boards: boardsByFolder.get(null) ?? [],
  };
}

/**
 * Ancestor chain for a folder, nearest parent first, ending at the root folder.
 * Used for breadcrumbs and move dialogs. Returns an empty array for a root
 * folder and stops safely on corrupt cycles.
 */
export function folderAncestors(
  folders: FolderSummary[],
  folderId: string | null,
): FolderSummary[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ancestors: FolderSummary[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    ancestors.push(folder);
    current = folder.parentId;
  }
  return ancestors;
}

/** Human-readable path such as `Marketing / Q3 / Launch`. */
export function folderPathLabel(
  folders: FolderSummary[],
  folderId: string | null,
): string {
  if (!folderId) return "Project root";
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return "Project root";
  return [...folderAncestors(folders, folderId)]
    .reverse()
    .map((item) => item.name)
    .concat(folder.name)
    .join(" / ");
}

/** Descendant ids of a folder, including itself, for move-target filtering. */
export function folderSubtreeIds(
  folders: FolderSummary[],
  folderId: string,
): Set<string> {
  const children = new Map<string | null, FolderSummary[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const ids = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}
