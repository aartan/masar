import * as React from "react";

import { api } from "@/lib/client-api";
import type { BoardSummary, ProjectSummary } from "@/lib/types";

interface WorkspaceUser {
  name: string;
  email: string;
}

interface WorkspaceContextValue {
  projects: ProjectSummary[];
  boards: BoardSummary[];
  user: WorkspaceUser;
  conflictCount: number;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  refreshBoards(): Promise<void>;
  reorderProjects(projectIds: string[]): Promise<void>;
  /**
   * Set the exact ordering of a project's boards, moving any board dragged in
   * from another project. Powers both reorder-within-project and cross-project
   * drag.
   */
  moveBoards(projectId: string, boardIds: string[]): Promise<void>;
}

const FALLBACK_USER: WorkspaceUser = {
  name: "Local workspace",
  email: "local@masar.app",
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [boards, setBoards] = React.useState<BoardSummary[]>([]);
  const [user, setUser] = React.useState<WorkspaceUser>(FALLBACK_USER);
  const [conflictCount, setConflictCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const [projectData, boardData, syncData] = await Promise.all([
        api<{ projects: ProjectSummary[] }>("/api/projects"),
        api<{ boards: BoardSummary[] }>("/api/boards"),
        api<{ state: { conflictCount: number } }>("/api/sync/state").catch(
          () => ({ state: { conflictCount: 0 } }),
        ),
      ]);
      if (request !== requestRef.current) return;
      setProjects(projectData.projects);
      setBoards(boardData.boards);
      setConflictCount(syncData.state.conflictCount ?? 0);
      setError(null);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError(
        caught instanceof Error ? caught.message : "Could not load the workspace.",
      );
    }
  }, []);

  // Kept for callers that only need the board list refreshed after a mutation.
  const refreshBoards = refresh;

  const reorderProjects = React.useCallback(
    async (projectIds: string[]) => {
      const byId = new Map(projects.map((project) => [project.id, project]));
      const next = projectIds.map((id) => {
        const project = byId.get(id);
        if (!project) throw new Error("Could not reorder projects.");
        return project;
      });

      const request = ++requestRef.current;
      const previous = projects;
      setProjects(next.map((project, index) => ({ ...project, position: index })));
      try {
        const data = await api<{ projects: ProjectSummary[] }>(
          "/api/projects/reorder",
          { method: "POST", body: JSON.stringify({ projectIds }) },
        );
        if (request !== requestRef.current) return;
        setProjects(data.projects);
        setError(null);
      } catch (caught) {
        if (request === requestRef.current) setProjects(previous);
        throw caught;
      }
    },
    [projects],
  );

  const moveBoards = React.useCallback(
    async (projectId: string, boardIds: string[]) => {
      const request = ++requestRef.current;
      const previous = boards;
      // Optimistically re-home and re-order the affected boards.
      const order = new Map(boardIds.map((id, index) => [id, index]));
      setBoards((current) =>
        current.map((board) =>
          order.has(board.id)
            ? { ...board, projectId, position: order.get(board.id)! }
            : board,
        ),
      );
      try {
        const data = await api<{ boards: BoardSummary[] }>("/api/boards/move", {
          method: "POST",
          body: JSON.stringify({ projectId, boardIds }),
        });
        if (request !== requestRef.current) return;
        setBoards(data.boards);
        setError(null);
      } catch (caught) {
        if (request === requestRef.current) setBoards(previous);
        throw caught;
      }
    },
    [boards],
  );

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [me, projectData, boardData, syncData] = await Promise.all([
          api<{ user: WorkspaceUser }>("/api/me"),
          api<{ projects: ProjectSummary[] }>("/api/projects"),
          api<{ boards: BoardSummary[] }>("/api/boards"),
          api<{ state: { conflictCount: number } }>("/api/sync/state").catch(
            () => ({ state: { conflictCount: 0 } }),
          ),
        ]);
        if (!active) return;
        setUser({ name: me.user.name, email: me.user.email });
        setProjects(projectData.projects);
        setBoards(boardData.boards);
        setConflictCount(syncData.state.conflictCount ?? 0);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the workspace.",
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // When a background sync cycle completes, the local database may contain
  // changes from another device (or a workspace import). Refresh the hierarchy
  // so the UI reflects them without a manual reload.
  React.useEffect(() => {
    const bridge = window.masarDesktop;
    if (!bridge) return;
    let previousPhase = "";
    return bridge.onSyncStatus((status) => {
      const completed = previousPhase === "syncing" && status.phase === "idle";
      previousPhase = status.phase;
      if (completed) void refresh();
    });
  }, [refresh]);

  const value = React.useMemo(
    () => ({
      projects,
      boards,
      user,
      conflictCount,
      loading,
      error,
      refresh,
      refreshBoards,
      reorderProjects,
      moveBoards,
    }),
    [
      projects,
      boards,
      user,
      conflictCount,
      loading,
      error,
      refresh,
      refreshBoards,
      reorderProjects,
      moveBoards,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = React.useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
