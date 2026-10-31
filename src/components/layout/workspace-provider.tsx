import * as React from "react";

import { api } from "@/lib/client-api";
import type { BoardSummary } from "@/lib/types";

interface WorkspaceUser {
  name: string;
  email: string;
}

interface WorkspaceContextValue {
  boards: BoardSummary[];
  user: WorkspaceUser;
  loading: boolean;
  error: string | null;
  refreshBoards(): Promise<void>;
}

const FALLBACK_USER: WorkspaceUser = {
  name: "Local workspace",
  email: "local@masar.app",
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [boards, setBoards] = React.useState<BoardSummary[]>([]);
  const [user, setUser] = React.useState<WorkspaceUser>(FALLBACK_USER);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);

  const refreshBoards = React.useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const data = await api<{ boards: BoardSummary[] }>("/api/boards");
      if (request !== requestRef.current) return;
      setBoards(data.boards);
      setError(null);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError(
        caught instanceof Error ? caught.message : "Could not load the workspace.",
      );
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [me, boardData] = await Promise.all([
          api<{ user: WorkspaceUser }>("/api/me"),
          api<{ boards: BoardSummary[] }>("/api/boards"),
        ]);
        if (!active) return;
        setUser({ name: me.user.name, email: me.user.email });
        setBoards(boardData.boards);
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

  const value = React.useMemo(
    () => ({ boards, user, loading, error, refreshBoards }),
    [boards, user, loading, error, refreshBoards],
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
