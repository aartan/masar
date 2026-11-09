import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  PenLine,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
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
import { SaveIndicator } from "@/components/shared/save-indicator";
import { SpaceDescription } from "@/components/shared/space-description";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiBlob, errorMessage } from "@/lib/client-api";
import {
  IMAGE_ACCEPT,
  isSupportedImageMime,
  SUPPORTED_IMAGE_FORMATS_LABEL,
} from "@/lib/image-file";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { BoardSummary, WhiteboardScene } from "@/lib/types";
import {
  blobToDataUrl,
  hydrateSceneFiles,
} from "@/lib/whiteboard-image-hydration";
import {
  forgetPendingScene,
  rememberPendingScene,
  takePendingScene,
} from "@/lib/whiteboard-pending-scene";
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

/** Reads local image copies during hydration. */
const cacheReader = {
  cached: async (boardId: string, fileId: string): Promise<Blob | null> => {
    try {
      return await apiBlob(
        `/api/boards/${boardId}/images/${encodeURIComponent(fileId)}/cache`,
      );
    } catch {
      return null;
    }
  },
};

/**
 * Fetch the remote copies of referenced files in the background. Files that
 * were not served from the local cache are added to the canvas as they land;
 * once a remote copy is confirmed available and displayed, the local cached
 * copy is discarded. Files in `skipFileIds` were already fetched during the
 * blocking load and are left alone.
 */
async function fillRemoteSceneImages(
  boardId: string,
  files: Record<string, unknown>,
  references: Map<string, string>,
  cachedFileIds: Set<string>,
  excalidraw: ExcalidrawImperativeAPI,
  isActive: () => boolean,
  skipFileIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  await Promise.all(
    [...references.entries()].map(async ([fileId, imageId]) => {
      if (skipFileIds.has(fileId)) return;
      try {
        const blob = await apiBlob(`/api/images/${encodeURIComponent(imageId)}`);
        const dataURL = await blobToDataUrl(blob);
        if (!isActive()) return;
        if (!cachedFileIds.has(fileId)) {
          const source = files[fileId] as Record<string, unknown> | undefined;
          excalidraw.addFiles([
            {
              id: fileId,
              mimeType:
                typeof source?.mimeType === "string"
                  ? source.mimeType
                  : "image/webp",
              dataURL,
            } as BinaryFileData,
          ]);
        }
        if (cachedFileIds.has(fileId)) {
          // Remote confirmed available and displayed: drop the local copy.
          await api(
            `/api/boards/${boardId}/images/${encodeURIComponent(fileId)}/cache`,
            { method: "DELETE" },
          ).catch(() => undefined);
        }
      } catch {
        // Keep the cached copy (or the reference) and retry on the next visit.
      }
    }),
  );
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

function unsupportedUploadFiles(files: File[]): File[] {
  return files.filter((file) => {
    const declared = file.type.trim().toLowerCase();
    if (!declared || declared === "application/octet-stream") return false;
    return !isSupportedImageMime(declared);
  });
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
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRemoteRef = React.useRef(false);
  /** True while the component is mounted (guards background image fills). */
  const mountedRef = React.useRef(true);
  /** fileId → stored image id for files loaded from (or saved to) R2. */
  const externalImagesRef = React.useRef<Map<string, string>>(new Map());
  /** File ids already written to the local image cache this session. */
  const cachedFilesRef = React.useRef<Set<string>>(new Set());
  /** Remote fills queued until the Excalidraw instance is ready. */
  const remoteFillRef = React.useRef<{
    boardId: string;
    files: Record<string, unknown>;
    references: Map<string, string>;
    cachedFileIds: Set<string>;
    skipFileIds: Set<string>;
  } | null>(null);
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
      onStatus: (next) => {
        setStatus(next);
        // Once everything is persisted the in-memory handoff for this board
        // can be dropped.
        if (next.phase === "saved") forgetPendingScene(boardIdRef.current);
      },
    });
  }

  /**
   * Fetch the remote copies of the current scene's referenced files, adding
   * any that were not already available locally to the canvas.
   */
  const startRemoteFill = React.useCallback(
    (
      files: Record<string, unknown>,
      references: Map<string, string>,
      cachedFileIds: Set<string>,
      skipFileIds: Set<string> = new Set(),
    ) => {
      const excalidraw = apiRef.current;
      if (excalidraw) {
        void fillRemoteSceneImages(
          boardIdRef.current,
          files,
          references,
          cachedFileIds,
          excalidraw,
          () => mountedRef.current,
          skipFileIds,
        );
      } else {
        remoteFillRef.current = {
          boardId: boardIdRef.current,
          files,
          references,
          cachedFileIds,
          skipFileIds,
        };
      }
    },
    [],
  );

  // Load the persisted scene once.
  React.useEffect(() => {
    let active = true;
    setLoadError(null);
    void api<{ scene: WhiteboardScene }>(`/api/boards/${board.id}/scene`)
      .then(async (result) => {
        if (!active) return;
        const raw = result.scene.scene || "{}";
        // Prefer unsaved work from a previous mount (the user navigated away
        // while a save was still in flight, so the persisted scene can lag
        // behind the canvas).
        const pending = takePendingScene(board.id, raw);
        const source = pending ?? raw;
        const parsed = parseScene(source);
        const hydrated = await hydrateSceneFiles(
          board.id,
          (parsed?.files ?? {}) as Record<string, unknown>,
          cacheReader,
        );
        if (!active) return;
        // Halt the first paint until every referenced image that is not in
        // the local cache has been fetched from remote storage. Files served
        // from the cache (or embedded in the scene) render immediately, so a
        // board is never blocked by images that are already available
        // locally. A fetch failure keeps the reference and is retried by the
        // background fill instead of blocking forever.
        const preloadedFileIds = new Set<string>();
        await Promise.all(
          [...hydrated.references.entries()].map(async ([fileId, imageId]) => {
            if (hydrated.cachedFileIds.has(fileId)) return;
            try {
              const blob = await apiBlob(
                `/api/images/${encodeURIComponent(imageId)}`,
              );
              const dataURL = await blobToDataUrl(blob);
              const file = hydrated.files[fileId];
              if (file && typeof file === "object") {
                hydrated.files[fileId] = {
                  ...(file as Record<string, unknown>),
                  dataURL,
                };
                preloadedFileIds.add(fileId);
              }
            } catch {
              // Keep the reference; the background fill retries it.
            }
          }),
        );
        if (!active) return;
        loopRef.current!.setSavedScene(raw);
        externalImagesRef.current = hydrated.references;
        // Files that still hold a `masar://` reference are not renderable
        // yet; leave them out so the background remote fill can add them (a
        // file already present in the scene is never updated by addFiles).
        const renderableFiles = Object.fromEntries(
          Object.entries(hydrated.files).filter(
            ([, file]) =>
              typeof file === "object" &&
              file !== null &&
              !imageReferenceId((file as Record<string, unknown>).dataURL),
          ),
        ) as Record<string, unknown>;
        setInitialData(
          parsed
            ? {
                ...parsed,
                files: renderableFiles as unknown as BinaryFiles,
              }
            : {
                elements: [],
                appState: { showWelcomeScreen: false },
                files: renderableFiles as unknown as BinaryFiles,
              },
        );
        // Continue the interrupted save so the pending scene reaches the
        // database (and the upload finishes in the background).
        if (pending) {
          const loop = loopRef.current!;
          loop.change(pending);
          loop.flush();
        }
        if (hydrated.references.size > 0) {
          startRemoteFill(
            (parsed?.files ?? {}) as Record<string, unknown>,
            hydrated.references,
            hydrated.cachedFileIds,
            preloadedFileIds,
          );
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [board.id, startRemoteFill]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Excalidraw owns its file input, paste handler, and drop handler. Block
   * unsupported files in the capture phase so they never reach the canvas.
   * The save endpoints validate again, but this gives immediate feedback.
   */
  React.useEffect(() => {
    if (readOnly) return;
    const container = containerRef.current;
    if (!container) return;

    const within = (target: EventTarget | null): boolean =>
      target instanceof Node && container.contains(target);

    const reject = (files: File[]): boolean => {
      const invalid = unsupportedUploadFiles(files);
      if (invalid.length === 0) return false;

      const names = invalid.map((file) => file.name).join(", ");
      toast.error("Only image files can be added to whiteboards", {
        description: `${names}: choose ${SUPPORTED_IMAGE_FORMATS_LABEL} images.`,
      });
      return true;
    };

    const handleDrop = (event: DragEvent) => {
      if (!within(event.target)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!reject(files)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      const active = document.activeElement;
      if (!within(target) && !(active instanceof Node && container.contains(active))) {
        return;
      }
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!reject(files)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "file") {
        return;
      }
      if (!container.contains(target)) return;
      const files = Array.from(target.files ?? []);
      if (!reject(files)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.value = "";
    };

    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("change", handleChange, true);

    const applyAccept = () => {
      container
        .querySelectorAll<HTMLInputElement>('input[type="file"]')
        .forEach((input) => {
          if (input.accept !== IMAGE_ACCEPT) input.accept = IMAGE_ACCEPT;
        });
    };
    applyAccept();
    const observer = new MutationObserver(applyAccept);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["accept", "type"],
    });

    return () => {
      document.removeEventListener("drop", handleDrop, true);
      document.removeEventListener("paste", handlePaste, true);
      document.removeEventListener("change", handleChange, true);
      observer.disconnect();
    };
  }, [readOnly]);

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

      const hydrated = await hydrateSceneFiles(
        board.id,
        (parsed.files ?? {}) as Record<string, unknown>,
        cacheReader,
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
      const files = Object.values(hydrated.files).filter(
        (file) =>
          typeof file === "object" &&
          file !== null &&
          !imageReferenceId((file as Record<string, unknown>).dataURL),
      ) as BinaryFileData[];
      if (files.length > 0) excalidraw.addFiles(files);
      if (hydrated.references.size > 0) {
        startRemoteFill(
          (parsed.files ?? {}) as Record<string, unknown>,
          hydrated.references,
          hydrated.cachedFileIds,
        );
      }
      setStatus({ phase: "saved", at: Date.now() });
    } catch {
      /* Keep the current canvas if a background refresh fails. */
    }
  }, [board.id, initialData, startRemoteFill]);

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

      // Retain newly added images in the local cache immediately so they
      // survive navigation before the scene save lands. Existing files and
      // externally stored images are skipped.
      for (const [fileId, file] of Object.entries(files)) {
        if (cachedFilesRef.current.has(fileId)) continue;
        const dataURL = (file as { dataURL?: unknown }).dataURL;
        if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) {
          cachedFilesRef.current.add(fileId);
          continue;
        }
        cachedFilesRef.current.add(fileId);
        if (externalImagesRef.current.has(fileId)) continue;
        void api(
          `/api/boards/${boardIdRef.current}/images/${encodeURIComponent(fileId)}/cache`,
          {
            method: "PUT",
            body: JSON.stringify({ dataURL }),
          },
        ).catch(() => undefined);
      }

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
        forgetPendingScene(boardIdRef.current);
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
      // Keep the unsaved state available for the next mount of this board.
      rememberPendingScene(boardIdRef.current, serialized);
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
        <PenLine className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-[15px] font-semibold">
              {board.name}
            </h1>
            {readOnly && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Read-only (archived)
              </span>
            )}
          </div>
          <SpaceDescription description={board.description} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
        ref={containerRef}
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
            excalidrawAPI={(instance) => {
              apiRef.current = instance;
              const pending = remoteFillRef.current;
              if (pending) {
                remoteFillRef.current = null;
                void fillRemoteSceneImages(
                  pending.boardId,
                  pending.files,
                  pending.references,
                  pending.cachedFileIds,
                  instance,
                  () => mountedRef.current,
                  pending.skipFileIds,
                );
              }
            }}
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

