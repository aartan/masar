import * as React from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  Loader2,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";

import { useWorkspace } from "@/components/layout/workspace-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client-api";
import type { BoardSummary, WhiteboardScene } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Matches the server MAX_SCENE_BYTES / MAX_ENTITY_BYTES ceiling. */
const MAX_SCENE_BYTES = 2 * 1024 * 1024;
const SAVE_DEBOUNCE_MS = 1_200;

type SaveStatus =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  | { phase: "error"; message: string }
  | { phase: "too_large" };

interface SceneSnapshot {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

function serializeScene(snapshot: SceneSnapshot): string {
  // appState holds transient UI like collaborators and the pointer; persist
  // only what is meaningful for reload. Excalidraw's restore() fills the rest.
  const { collaborators: _collaborators, ...appState } = snapshot.appState;
  return JSON.stringify({
    elements: snapshot.elements,
    appState,
    files: snapshot.files,
  });
}

function parseScene(raw: string): ExcalidrawInitialDataState | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
      scrollToContent: true,
    };
  } catch {
    return null;
  }
}

export function WhiteboardView({ board }: { board: BoardSummary }) {
  const { resolvedTheme } = useTheme();
  const { projects } = useWorkspace();
  const readOnly =
    projects.find((project) => project.id === board.projectId)?.archived ?? false;

  const [initialData, setInitialData] =
    React.useState<ExcalidrawInitialDataState | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SaveStatus>({ phase: "idle" });

  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = React.useRef<string>("");
  const pendingRef = React.useRef<string | null>(null);

  // Load the persisted scene once.
  React.useEffect(() => {
    let active = true;
    setLoadError(null);
    void api<{ scene: WhiteboardScene }>(`/api/boards/${board.id}/scene`)
      .then((result) => {
        if (!active) return;
        lastSavedRef.current = result.scene.scene || "{}";
        setInitialData(parseScene(result.scene.scene) ?? { elements: [] });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [board.id]);

  const persist = React.useCallback(
    async (serialized: string) => {
      if (serialized === lastSavedRef.current) return;
      if (serialized.length > MAX_SCENE_BYTES) {
        setStatus({ phase: "too_large" });
        return;
      }
      pendingRef.current = serialized;
      setStatus({ phase: "saving" });
      try {
        await api(`/api/boards/${board.id}/scene`, {
          method: "PUT",
          body: JSON.stringify({ scene: serialized }),
        });
        lastSavedRef.current = serialized;
        pendingRef.current = null;
        setStatus({ phase: "saved", at: Date.now() });
      } catch (error) {
        setStatus({ phase: "error", message: errorMessage(error) });
      }
    },
    [board.id],
  );

  const handleChange = React.useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      if (readOnly) return;
      const serialized = serializeScene({
        elements,
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
      });
      if (serialized === lastSavedRef.current) return;
      pendingRef.current = serialized;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void persist(serialized);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist, readOnly],
  );

  // Flush an outstanding edit on unmount so navigating away never loses work.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const pending = pendingRef.current;
      if (pending && pending !== lastSavedRef.current) {
        // Fire-and-forget: the component is going away.
        void api(`/api/boards/${board.id}/scene`, {
          method: "PUT",
          body: JSON.stringify({ scene: pending }),
        }).catch(() => undefined);
      }
    };
  }, [board.id]);

  function retry() {
    const pending = pendingRef.current;
    if (pending) void persist(pending);
  }

  if (loadError) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="font-display mt-4 text-xl font-semibold">
            Could not load this whiteboard
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {loadError}
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-3 border-b border-border/60 bg-background/65 px-4 py-3 sm:px-6">
        <PenLine className="size-4 text-muted-foreground" />
        <h1 className="truncate font-display text-[15px] font-semibold">
          {board.name}
        </h1>
        {readOnly && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Read-only (archived)
          </span>
        )}
        <div className="ml-auto">
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {initialData === null ? (
          <div className="grid h-full place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <Excalidraw
            excalidrawAPI={(instance) => (apiRef.current = instance)}
            initialData={initialData}
            theme={resolvedTheme}
            viewModeEnabled={readOnly}
            onChange={handleChange}
            UIOptions={{ canvasActions: { loadScene: false } }}
          />
        )}
      </div>
    </div>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status.phase === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status.phase === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Saved
      </span>
    );
  }
  if (status.phase === "too_large") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
        <CloudOff className="size-3.5" />
        Too large to save — reduce images
      </span>
    );
  }
  if (status.phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300",
        )}
        title={status.message}
      >
        <RefreshCw className="size-3.5" />
        Couldn’t save — retry
      </button>
    );
  }
  return null;
}
