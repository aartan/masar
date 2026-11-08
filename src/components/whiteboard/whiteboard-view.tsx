import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CloudOff,
  Loader2,
  PenLine,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard-theme.css";

import { BoardSettingsDialog } from "@/components/board/board-dialogs";
import { PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { useTheme } from "@/components/theme-provider";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiBlob, errorMessage } from "@/lib/client-api";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { BoardSummary, WhiteboardScene } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  WhiteboardSaveLoop,
  type WhiteboardSaveStatus,
} from "@/lib/whiteboard-save-loop";
import {
  imageReferenceId,
  sceneImageReferences,
  serializeWhiteboardScene,
} from "@/lib/whiteboard-scene";

const SAVE_DEBOUNCE_MS = 1_200;

type SaveStatus = WhiteboardSaveStatus;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Turn stored `masar://` references into data URLs Excalidraw can render, and
 * remember which file belongs to which stored image so saves can put the
 * reference back instead of re-uploading the bytes.
 */
async function hydrateSceneImages(files: Record<string, unknown>): Promise<{
  files: Record<string, unknown>;
  references: Map<string, string>;
}> {
  const hydrated = { ...files };
  const references = new Map<string, string>();

  await Promise.all(
    Object.entries(files).map(async ([fileId, value]) => {
      if (!value || typeof value !== "object") return;
      const file = value as Record<string, unknown>;
      const imageId = imageReferenceId(file.dataURL);
      if (!imageId) return;
      references.set(fileId, imageId);
      try {
        const blob = await apiBlob(`/api/images/${encodeURIComponent(imageId)}`);
        hydrated[fileId] = { ...file, dataURL: await blobToDataUrl(blob) };
      } catch {
        // Keep the reference when the image cannot be fetched. Excalidraw then
        // shows the file as unavailable instead of failing the whole canvas.
      }
    }),
  );

  return { files: hydrated, references };
}

function parseScene(raw: string): ExcalidrawInitialDataState | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: {
        ...(parsed.appState ?? {}),
        showWelcomeScreen: false,
      },
      files: parsed.files ?? {},
      scrollToContent: true,
    };
  } catch {
    return null;
  }
}

export function WhiteboardView({ board: initialBoard }: { board: BoardSummary }) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { projects, refresh } = useWorkspace();
  const [board, setBoard] = React.useState(initialBoard);
  const readOnly =
    projects.find((project) => project.id === board.projectId)?.archived ?? false;

  const [initialData, setInitialData] =
    React.useState<ExcalidrawInitialDataState | null>(null);
  const showSceneLoading = useDelayedLoading(initialData === null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SaveStatus>({ phase: "idle" });
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  /** Tracks the board id for the save loop even if the prop is swapped. */
  const boardIdRef = React.useRef(board.id);

  React.useEffect(() => {
    setBoard(initialBoard);
    boardIdRef.current = initialBoard.id;
  }, [initialBoard]);

  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRemoteRef = React.useRef(false);
  /** fileId → stored image id for files loaded from (or saved to) R2. */
  const externalImagesRef = React.useRef<Map<string, string>>(new Map());
  /**
   * Owns dirty-state tracking and serializes saves so slow image uploads can
   * never produce overlapping PUTs or stale canonical scenes.
   */
  const loopRef = React.useRef<WhiteboardSaveLoop | null>(null);
  if (loopRef.current === null) {
    loopRef.current = new WhiteboardSaveLoop({
      save: async (serialized) => {
        const result = await api<{ scene: WhiteboardScene }>(
          `/api/boards/${boardIdRef.current}/scene`,
          {
            method: "PUT",
            body: JSON.stringify({ scene: serialized }),
          },
        );
        const saved = result.scene.scene || "{}";
        // The server may have replaced embedded images with references, so the
        // canonical saved scene (not the request body) is what we compare
        // against next time.
        externalImagesRef.current = sceneImageReferences(saved);
        return saved;
      },
      onStatus: (next) => setStatus(next),
    });
  }

  // Load the persisted scene once.
  React.useEffect(() => {
    let active = true;
    setLoadError(null);
    void api<{ scene: WhiteboardScene }>(`/api/boards/${board.id}/scene`)
      .then(async (result) => {
        if (!active) return;
        const raw = result.scene.scene || "{}";
        const parsed = parseScene(raw);
        const hydrated = await hydrateSceneImages(
          (parsed?.files ?? {}) as Record<string, unknown>,
        );
        if (!active) return;
        loopRef.current!.setSavedScene(raw);
        externalImagesRef.current = hydrated.references;
        setInitialData(
          parsed
            ? {
                ...parsed,
                files: hydrated.files as unknown as BinaryFiles,
              }
            : {
                elements: [],
                appState: { showWelcomeScreen: false },
                files: hydrated.files as unknown as BinaryFiles,
              },
        );
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [board.id]);

  const refreshFromSync = React.useCallback(async () => {
    // Never replace a canvas with pending or in-flight local edits.
    const excalidraw = apiRef.current;
    const loop = loopRef.current;
    if (
      initialData === null ||
      !loop ||
      loop.pendingScene !== null ||
      !excalidraw
    ) {
      return;
    }
    try {
      const result = await api<{ scene: WhiteboardScene }>(
        `/api/boards/${board.id}/scene`,
      );
      const remote = result.scene.scene || "{}";
      if (remote === loop.lastSavedScene) return;
      const parsed = parseScene(remote);
      if (!parsed) return;

      const hydrated = await hydrateSceneImages(
        (parsed.files ?? {}) as Record<string, unknown>,
      );
      // A local edit may have started while the scene was loading.
      if (loop.pendingScene !== null) return;

      loop.setSavedScene(remote);
      externalImagesRef.current = hydrated.references;
      applyingRemoteRef.current = true;
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 1_000);
      excalidraw.updateScene({
        elements: parsed.elements,
        appState: parsed.appState as AppState,
      });
      const files = Object.values(hydrated.files) as BinaryFileData[];
      if (files.length > 0) excalidraw.addFiles(files);
      setStatus({ phase: "saved", at: Date.now() });
    } catch {
      /* Keep the current canvas if a background refresh fails. */
    }
  }, [board.id, initialData]);

  useOnSyncComplete(() => {
    void refreshFromSync();
  });

  const handleChange = React.useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      if (readOnly || applyingRemoteRef.current) return;
      const serialized = serializeWhiteboardScene(
        {
          elements,
          appState: appState as unknown as Record<string, unknown>,
          files: files as unknown as Record<string, unknown>,
        },
        externalImagesRef.current,
      );
      const loop = loopRef.current;
      if (!loop) return;
      loop.change(serialized);
      if (loop.isContentSaved(serialized)) {
        if (!loop.saving) {
          // The canvas matches what is persisted (for example an edit was
          // undone back to the saved state). Normalize the indicator instead
          // of leaving it stuck at "Unsaved changes".
          setStatus((current) =>
            current.phase === "saved"
              ? current
              : { phase: "saved", at: Date.now() },
          );
        }
        // While a save is in flight the loop has queued this state and emits
        // the final status when the drain finishes.
        return;
      }
      setStatus((current) =>
        current.phase === "unsaved" ? current : { phase: "unsaved" },
      );
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        loopRef.current?.flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [readOnly],
  );

  // Flush an outstanding edit on unmount so navigating away never loses work.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const loop = loopRef.current;
      if (!loop) return;
      const pending = loop.pendingScene;
      if (pending && !loop.isContentSaved(pending) && !loop.saving) {
        // Fire-and-forget: the component is going away. When a save is still
        // in flight the loop drains this pending state itself after unmount,
        // so the flush must not race it.
        void api(`/api/boards/${board.id}/scene`, {
          method: "PUT",
          body: JSON.stringify({ scene: pending }),
        }).catch(() => undefined);
      }
    };
  }, [board.id]);

  function retry() {
    const loop = loopRef.current;
    if (loop && loop.pendingScene !== null) loop.flush();
  }

  async function deleteBoard() {
    try {
      await api(`/api/boards/${board.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      void refresh();
      navigate("/");
    } catch (error) {
      setStatus({ phase: "error", message: errorMessage(error) });
    }
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
    <>
    <PageSurface className="flex h-full flex-col">
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
        <div className="ml-auto flex items-center gap-2">
          <SaveIndicator status={status} onRetry={retry} />
          {!readOnly && (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
              aria-label="Whiteboard settings"
            >
              <Settings2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div
        className="masar-whiteboard min-h-0 flex-1"
        onKeyDownCapture={(event) => {
          // The help button is hidden; also swallow its "?" shortcut so the
          // help dialog can't be opened from the whiteboard.
          if (event.key === "?") {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        {initialData === null ? (
          showSceneLoading ? (
            <div
              className="grid h-full place-items-center text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 text-[12.5px]">
                <Skeleton className="size-5 rounded-full" />
                Loading whiteboard…
              </div>
            </div>
          ) : (
            <div className="h-full" aria-busy="true" />
          )
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
    </PageSurface>
    <BoardSettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      board={board}
      labels={[]}
      onSaved={(saved) => {
        setBoard(saved);
        void refresh();
      }}
      onRequestDelete={() => {
        setSettingsOpen(false);
        setDeleteOpen(true);
      }}
    />
    <ConfirmDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      title={`Delete ${board.name}?`}
      description="The whiteboard canvas will be permanently deleted. This cannot be undone."
      confirmLabel="Delete whiteboard"
      onConfirm={deleteBoard}
    />
    </>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status.phase === "unsaved") {
    return (
      <span className="text-[12px] text-muted-foreground">Unsaved changes</span>
    );
  }
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
        <Check className="size-3.5 text-success" />
        Saved
      </span>
    );
  }
  if (status.phase === "too_large") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-warning">
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
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] text-warning transition-colors hover:bg-warning/10",
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
