import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FileText, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  BlockNoteEditor,
  filterSuggestionItems,
  type PartialBlock,
} from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BlockNoteViewEditor,
  FormattingToolbar,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  blockTypeSelectItems as getBlockTypeSelectItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./note-theme.css";

import { BoardSettingsDialog } from "@/components/board/board-dialogs";
import { PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { useTheme } from "@/components/theme-provider";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SaveIndicator } from "@/components/shared/save-indicator";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client-api";
import {
  isImageStorageUnavailable,
  uploadImageFile,
  validateImageFile,
} from "@/lib/client-image";
import { IMAGE_ACCEPT } from "@/lib/image-file";
import { blobToDataUrl } from "@/lib/whiteboard-image-hydration";
import {
  apiNoteImageCacheReader,
  hydrateNoteImages,
} from "@/lib/note-image-hydration";
import {
  canonicalizeNoteDocument,
  noteDocumentsEquivalent,
} from "@/lib/note-document";
import {
  forgetPendingDocument,
  rememberPendingDocument,
  takePendingDocument,
} from "@/lib/note-pending-document";
import { NoteSaveLoop, type NoteSaveStatus } from "@/lib/note-save-loop";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { BoardSummary, NoteDocument } from "@/lib/types";

const SAVE_DEBOUNCE_MS = 1_200;

/** Note blocks that upload a file which is not necessarily an image. */
const NON_IMAGE_UPLOAD_BLOCKS = new Set(["audio", "file", "video"]);
const NON_IMAGE_UPLOAD_KEYS = new Set(["audio", "file", "video"]);
const NON_IMAGE_UPLOAD_TITLES = new Set(["audio", "file", "video"]);

function isNonImageUploadItem(item: DefaultReactSuggestionItem): boolean {
  // The runtime slash-menu item carries a `key`, although the public React
  // type omits it. Fall back to the title so the filter keeps working if the
  // type changes.
  const key = (item as DefaultReactSuggestionItem & { key?: string }).key;
  return (
    (key ? NON_IMAGE_UPLOAD_KEYS.has(key) : false) ||
    NON_IMAGE_UPLOAD_TITLES.has(item.title.toLowerCase())
  );
}

function parseBlocks(raw: string): PartialBlock[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? (parsed as PartialBlock[])
      : [];
  } catch {
    return [];
  }
}

/**
 * Upload a pasted/dropped image to Cloudflare R2 through the shared image
 * storage route (the same backend the whiteboard uses) and return its URL for
 * the BlockNote image block. The bytes are retained in the local image cache
 * first, keyed by the remote image id, so the image survives offline periods.
 *
 * When image storage is unavailable (the free local workspace, or a premium
 * session that cannot reach the API), the upload falls back to an embedded
 * data URL — BlockNote's default behaviour and the same arrangement as the
 * whiteboard, where the free workspace keeps embedded images.
 */
async function uploadNoteImage(
  boardId: string,
  file: File,
): Promise<string> {
  const validation = await validateImageFile(file);
  if (!validation.ok) {
    toast.error("Only image files can be added to notes", {
      description: `${file.name}: ${validation.message}`,
    });
    throw new Error(validation.message);
  }
  const validatedFile = validation.file;

  try {
    const { imageId } = await uploadImageFile(validatedFile, "note");

    // Retain the bytes locally, keyed by the image id, so the note can still
    // render this image when the remote copy is unreachable. Best-effort: the
    // URL alone is already durable once R2 accepted the upload.
    try {
      const dataURL = await blobToDataUrl(validatedFile);
      await api(
        `/api/boards/${boardId}/images/${encodeURIComponent(imageId)}/cache`,
        {
          method: "PUT",
          body: JSON.stringify({ dataURL }),
        },
      );
    } catch {
      /* The remote copy is already stored; the cache is only a fallback. */
    }

    return `/api/images/${encodeURIComponent(imageId)}`;
  } catch (error) {
    if (!isImageStorageUnavailable(error)) {
      toast.error("Could not add image", {
        description: errorMessage(error),
      });
      throw error;
    }
    // Free workspace (or unavailable storage): embed the bytes instead of
    // losing the image. BlockNote renders data URLs natively.
    return blobToDataUrl(validatedFile);
  }
}

export function NoteView({ board: initialBoard }: { board: BoardSummary }) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { projects, refresh } = useWorkspace();
  const [board, setBoard] = React.useState(initialBoard);
  const readOnly =
    projects.find((project) => project.id === board.projectId)?.archived ?? false;

  const [editor, setEditor] = React.useState<BlockNoteEditor | null>(null);
  const showLoading = useDelayedLoading(editor === null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<NoteSaveStatus>({ phase: "idle" });
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  /** Tracks the board id for the save loop even if the prop is swapped. */
  const boardIdRef = React.useRef(board.id);

  React.useEffect(() => {
    setBoard(initialBoard);
    boardIdRef.current = initialBoard.id;
  }, [initialBoard]);

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRemoteRef = React.useRef(false);
  const pageRef = React.useRef<HTMLDivElement | null>(null);
  /** True while the component is mounted (guards async loads). */
  const mountedRef = React.useRef(true);
  /** Discards responses from sync refreshes superseded by a newer one. */
  const refreshGenerationRef = React.useRef(0);
  /**
   * Owns dirty-state tracking and serializes saves so slow uploads can never
   * produce overlapping PUTs or stale canonical documents.
   */
  const loopRef = React.useRef<NoteSaveLoop | null>(null);
  if (loopRef.current === null) {
    loopRef.current = new NoteSaveLoop({
      save: async (serialized) => {
        // Persist canonical image URLs; the editor may carry local-cache
        // serving URLs from hydration.
        const body = canonicalizeNoteDocument(
          serialized,
          boardIdRef.current,
        );
        const result = await api<{ document: NoteDocument }>(
          `/api/boards/${boardIdRef.current}/document`,
          {
            method: "PUT",
            body: JSON.stringify({ document: body }),
          },
        );
        return result.document.document || "[]";
      },
      onStatus: (next) => {
        setStatus(next);
        // Once everything is persisted the in-memory handoff for this board
        // can be dropped.
        if (next.phase === "saved") forgetPendingDocument(boardIdRef.current);
      },
      isEquivalent: (a, b) => noteDocumentsEquivalent(a, b, boardIdRef.current),
    });
  }

  /** Stable upload handler for the BlockNote editor instance. */
  const editorRef = React.useRef<BlockNoteEditor | null>(null);
  const uploadFileRef = React.useRef<
    (file: File, blockId?: string) => Promise<string>
  >(async () => "");
  uploadFileRef.current = async (file: File, blockId?: string) => {
    try {
      return await uploadNoteImage(boardIdRef.current, file);
    } catch (error) {
      // BlockNote inserts a file block before invoking the upload callback.
      // Remove it when validation or storage rejects the file so the note is
      // not left with an empty, unusable block.
      if (blockId) {
        window.setTimeout(() => {
          const instance = editorRef.current;
          if (instance?.getBlock(blockId)) instance.removeBlocks([blockId]);
        }, 0);
      }
      throw error;
    }
  };

  const getSlashMenuItems = React.useCallback(
    async (query: string) => {
      if (!editor) return [];
      return filterSuggestionItems(
        getDefaultReactSlashMenuItems(editor).filter(
          (item) => !isNonImageUploadItem(item),
        ),
        query,
      );
    },
    [editor],
  );

  // Load the persisted document once, then create the editor.
  React.useEffect(() => {
    let active = true;
    setLoadError(null);
    setEditor(null);
    editorRef.current = null;
    void api<{ document: NoteDocument }>(`/api/boards/${board.id}/document`)
      .then(async (result) => {
        if (!active) return;
        const raw = result.document.document || "[]";
        // Prefer unsaved work from a previous mount (the user navigated away
        // while a save was still in flight, so the persisted document can lag
        // behind the editor).
        const pending = takePendingDocument(board.id, raw);
        const source = pending ?? raw;
        const hydrated = await hydrateNoteImages(
          board.id,
          source,
          apiNoteImageCacheReader,
        );
        if (!active) return;
        loopRef.current!.setSavedDocument(raw);
        const instance = BlockNoteEditor.create({
          initialContent:
            parseBlocks(hydrated.document).length > 0
              ? parseBlocks(hydrated.document)
              : undefined,
          uploadFile: uploadFileRef.current,
        });
        editorRef.current = instance;
        setEditor(instance);
        // Continue the interrupted save so the pending document reaches the
        // database.
        if (pending) {
          const loop = loopRef.current!;
          loop.change(pending);
          loop.flush();
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [board.id]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * BlockNote's file block uses a wildcard in its hidden picker. The upload
   * callback rejects non-images, but restricting the picker as well gives
   * immediate feedback and keeps unsupported files out of the dialog.
   */
  React.useEffect(() => {
    const container = pageRef.current;
    if (!container) return;
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
    return () => observer.disconnect();
  }, []);

  const refreshFromSync = React.useCallback(async () => {
    // Never replace an editor with pending or in-flight local edits.
    const instance = editor;
    const loop = loopRef.current;
    if (!instance || !loop || loop.pendingDocument !== null || loop.saving) {
      return;
    }
    // A newer sync cycle supersedes this refresh; its response must not be
    // applied after fresher document data has already landed.
    const generation = ++refreshGenerationRef.current;
    try {
      const result = await api<{ document: NoteDocument }>(
        `/api/boards/${board.id}/document`,
      );
      if (generation !== refreshGenerationRef.current || !mountedRef.current) {
        return;
      }
      const remote = result.document.document || "[]";
      if (noteDocumentsEquivalent(remote, loop.lastSavedDocument, board.id)) {
        return;
      }
      const hydrated = await hydrateNoteImages(
        board.id,
        remote,
        apiNoteImageCacheReader,
      );
      // A local edit may have started while the document was loading.
      if (
        generation !== refreshGenerationRef.current ||
        !mountedRef.current ||
        loop.pendingDocument !== null ||
        loop.saving
      ) {
        return;
      }
      loop.setSavedDocument(remote);
      applyingRemoteRef.current = true;
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 1_000);
      instance.replaceBlocks(
        instance.document,
        parseBlocks(hydrated.document),
      );
      setStatus({ phase: "saved", at: Date.now() });
    } catch {
      /* Keep the current document if a background refresh fails. */
    }
  }, [board.id, editor]);

  useOnSyncComplete(() => {
    void refreshFromSync();
  });

  const handleChange = React.useCallback(
    (instance: BlockNoteEditor) => {
      if (readOnly || applyingRemoteRef.current) return;
      const serialized = JSON.stringify(instance.document);
      const loop = loopRef.current;
      if (!loop) return;
      loop.change(serialized);
      if (loop.isContentSaved(serialized)) {
        forgetPendingDocument(boardIdRef.current);
        if (!loop.saving) {
          // The document matches what is persisted (for example an edit was
          // undone back to the saved state). Normalize the indicator instead
          // of leaving it stuck at "Unsaved changes".
          setStatus((current) =>
            current.phase === "saved"
              ? current
              : { phase: "saved", at: Date.now() },
          );
        }
        return;
      }
      // Keep the unsaved state available for the next mount of this board.
      rememberPendingDocument(boardIdRef.current, serialized);
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
      const pending = loop.pendingDocument;
      if (pending && !loop.isContentSaved(pending) && !loop.saving) {
        // Fire-and-forget: the component is going away. When a save is still
        // in flight the loop drains this pending state itself after unmount,
        // so the flush must not race it.
        void api(`/api/boards/${board.id}/document`, {
          method: "PUT",
          body: JSON.stringify({
            document: canonicalizeNoteDocument(pending, board.id),
          }),
        }).catch(() => undefined);
      }
    };
  }, [board.id]);

  function retry() {
    const loop = loopRef.current;
    if (loop && loop.pendingDocument !== null) loop.flush();
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
            Could not load this note
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
      <PageSurface ref={pageRef} className="masar-note flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border/60 bg-background/65 px-4 py-3 sm:px-6">
          <FileText className="size-4 text-muted-foreground" />
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
                aria-label="Note settings"
              >
                <Settings2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {editor === null ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {showLoading ? (
              <div
                className="grid h-full place-items-center text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="size-4 animate-pulse rounded-full bg-muted" />
                  Loading note…
                </div>
              </div>
            ) : (
              <div className="h-full" aria-busy="true" />
            )}
          </div>
        ) : (
          <BlockNoteView
            editor={editor}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            editable={!readOnly}
            onChange={handleChange}
            formattingToolbar={false}
            slashMenu={false}
            renderEditor={false}
            className="flex min-h-0 flex-1 flex-col"
          >
            {!readOnly && (
              <>
                <SuggestionMenuController
                  triggerCharacter="/"
                  getItems={getSlashMenuItems}
                />
                <div className="masar-note-toolbar shrink-0 border-b border-border/60 bg-background/65">
                  <div className="mx-auto flex w-full max-w-[760px] items-center px-3 py-1.5 sm:px-5">
                    <FormattingToolbar
                      blockTypeSelectItems={getBlockTypeSelectItems(
                        editor,
                      ).filter(
                        (item) => !NON_IMAGE_UPLOAD_BLOCKS.has(item.type),
                      )}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[760px] px-5 py-8 sm:px-8 sm:py-12">
                {/* The space name is shown in the header bar above; the note
                    itself starts blank so the user owns every word in it. */}
                <BlockNoteViewEditor />
              </div>
            </div>
          </BlockNoteView>
        )}
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
        description="The note and all of its contents will be permanently deleted. This cannot be undone."
        confirmLabel="Delete note"
        onConfirm={deleteBoard}
      />
    </>
  );
}
