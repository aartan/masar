import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./note-theme.css";

import { BoardSettingsDialog } from "@/components/board/board-dialogs";
import { PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { useTheme } from "@/components/theme-provider";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ImageUploadDock } from "@/components/shared/image-upload-dock";
import { Button } from "@/components/ui/button";
import { NoteEditorSession } from "@/components/note/note-editor-session";
import { NoteHeader } from "@/components/note/note-header";
import { api, errorMessage } from "@/lib/client-api";
import { IMAGE_ACCEPT } from "@/lib/image-file";
import { parseNoteDocument } from "@/lib/note-document";
import {
  hasFileDrag,
  insertDroppedNoteImages,
  isNoteEditorTarget,
} from "@/lib/note-image-drop";
import {
  registerEmbeddedNoteImages,
  retryEmbeddedNoteImages,
} from "@/lib/note-image-retry";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useNoteAutosave } from "@/lib/use-note-autosave";
import { useNoteDocument } from "@/lib/use-note-document";
import { useNoteImages } from "@/lib/use-note-images";
import { useNoteSync } from "@/lib/use-note-sync";
import { useNoteWidth } from "@/lib/use-note-width";
import { useOnline } from "@/lib/use-online";
import type { ImageUploadItem } from "@/lib/use-image-uploads";
import type { BoardSummary } from "@/lib/types";

export function NoteView({ board: initialBoard }: { board: BoardSummary }) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { projects, refresh, imageStorage } = useWorkspace();
  const [board, setBoard] = React.useState(initialBoard);
  const readOnly =
    projects.find((project) => project.id === board.projectId)?.archived ?? false;

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [noteWidth, setNoteWidth] = useNoteWidth();
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const online = useOnline();

  const [editor, setEditor] = React.useState<BlockNoteEditor | null>(null);
  const editorRef = React.useRef<BlockNoteEditor | null>(null);
  const pageRef = React.useRef<HTMLDivElement | null>(null);
  /** True while the loaded document started empty (brand-new note). */
  const [noteIsEmpty, setNoteIsEmpty] = React.useState(false);

  React.useEffect(() => {
    setBoard(initialBoard);
  }, [initialBoard]);

  const document = useNoteDocument(board.id);
  const autosave = useNoteAutosave({ boardId: board.id, readOnly });
  const { uploadFile, uploads } = useNoteImages(board.id, editorRef, {
    imageStorageAvailable: imageStorage,
  });
  useNoteSync({ boardId: board.id, editor, autosave });

  /** Embedded images already registered as local-only dock items. */
  const embeddedRegisteredRef = React.useRef(new Set<string>());
  const embeddedRegistrationRef = React.useRef(false);

  /**
   * BlockNote only accepts file drops on the editable element itself. The
   * surrounding margins and the blank space below the document would reject
   * the drop, so the note surface handles files dropped outside the editor.
   */
  const handleNoteDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editor || readOnly) return;
    if (isNoteEditorTarget(editor, event.target)) return;
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleNoteDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editor || readOnly) return;
    if (isNoteEditorTarget(editor, event.target)) return;

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    event.preventDefault();
    void insertDroppedNoteImages({
      editor,
      files,
      point: { clientX: event.clientX, clientY: event.clientY },
    }).catch((error: unknown) => {
      toast.error("Could not add image", { description: errorMessage(error) });
    });
  };

  const showLoading = useDelayedLoading(
    editor === null && document.state.status === "loading",
  );

  // Reset the editor whenever the board changes so a stale instance (or an
  // in-flight response from the previous board) never feeds the new note.
  React.useEffect(() => {
    editorRef.current = null;
    setEditor(null);
    setOutlineOpen(false);
    setNoteIsEmpty(false);
    embeddedRegisteredRef.current.clear();
    embeddedRegistrationRef.current = false;
  }, [board.id]);

  /**
   * Surface images that were persisted as embedded data URLs. In a premium
   * workspace they are only local copies; the dock offers a retry that
   * uploads them to R2 and rewrites the blocks.
   */
  React.useEffect(() => {
    if (embeddedRegistrationRef.current) return;
    if (!editor || !imageStorage || readOnly) return;
    embeddedRegistrationRef.current = true;
    registerEmbeddedNoteImages(editor, uploads, embeddedRegisteredRef.current);
  }, [editor, imageStorage, readOnly, uploads]);

  const handleUploadRetry = React.useCallback(
    (item: ImageUploadItem) => {
      const instance = editorRef.current;
      if (!instance || !imageStorage) return;
      if (item.phase !== "local" && item.phase !== "failed") return;
      void retryEmbeddedNoteImages({
        editor: instance,
        boardId: board.id,
        uploads,
      }).catch((error: unknown) => {
        toast.error("Could not upload image", {
          description: errorMessage(error),
        });
      });
    },
    [board.id, imageStorage, uploads],
  );

  /**
   * Focus the title of a brand-new empty note so writing can start
   * immediately. Existing notes are left untouched: opening one must not
   * steal focus, place an invisible caret at the end of a long document or
   * jump its scroll position. BlockNoteView mounts the editor
   * asynchronously, so retry briefly until the editor DOM exists.
   */
  React.useEffect(() => {
    if (!editor || readOnly || !noteIsEmpty) return;
    let cancelled = false;
    const attempt = (remaining: number) => {
      if (cancelled) return;
      const element = editor.domElement;
      if (element) {
        // A click may have focused and positioned the editor while the DOM
        // was mounting; never override that user intent.
        const active = window.document.activeElement;
        if (active && element.contains(active)) return;
        const firstBlock = editor.document[0];
        if (firstBlock) editor.setTextCursorPosition(firstBlock, "end");
        editor.focus();
        return;
      }
      if (remaining > 0) {
        window.setTimeout(() => attempt(remaining - 1), 20);
      }
    };
    attempt(25);
    return () => {
      cancelled = true;
    };
  }, [editor, readOnly, noteIsEmpty]);

  /**
   * Cmd/Ctrl+S is muscle memory in a note editor. Autosave already persists
   * changes, so this shortcut simply flushes the pending save immediately
   * (and retries a failed one) instead of opening the browser's save dialog.
   */
  const getSaveLoop = autosave.loop;
  React.useEffect(() => {
    if (readOnly) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "s" ||
        event.isComposing
      ) {
        return;
      }
      event.preventDefault();
      getSaveLoop()?.flush();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [getSaveLoop, readOnly]);

  // Create the editor once the document for the current board is ready.
  const { setSavedDocument, adoptAndFlush, markSaved } = autosave;
  React.useEffect(() => {
    if (document.state.status !== "ready") return;
    if (document.state.boardId !== board.id) return;
    if (editorRef.current) return;

    autosave.setSavedDocument(
      document.state.persistedDocument,
      document.state.updatedAt,
    );

    const initialBlocks = (parseNoteDocument(
      document.state.hydratedDocument,
    ) ?? []) as unknown as PartialBlock[];
    const empty = initialBlocks.length === 0;
    const instance = BlockNoteEditor.create({
      initialContent: empty
        ? [{ type: "heading", props: { level: 1 } }]
        : initialBlocks,
      uploadFile: uploadFile,
      dictionary: {
        ...en,
        placeholders: {
          ...en.placeholders,
          default: "",
          emptyDocument: "",
          // A brand-new note invites its title, like Apple Notes; notes that
          // already have content label empty headings as headings.
          heading: empty ? "Title" : "Heading",
        },
      },
    });
    editorRef.current = instance;
    setEditor(instance);
    setNoteIsEmpty(empty);
    // Continue the interrupted save so the pending document reaches the
    // database. A clean load is already fully persisted: confirm it.
    if (document.state.adoptedPending) {
      adoptAndFlush(document.state.adoptedPending);
    } else {
      markSaved();
    }
  }, [
    autosave,
    board.id,
    document.state,
    setSavedDocument,
    adoptAndFlush,
    markSaved,
    uploadFile,
  ]);

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

  async function deleteBoard() {
    try {
      await api(`/api/boards/${board.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      void refresh();
      navigate("/");
    } catch (error) {
      toast.error("Could not delete this note", {
        description: errorMessage(error),
      });
    }
  }

  if (document.state.status === "malformed") {
    return (
      <NoteLoadError
        icon={<FileWarning className="size-5" />}
        title="This note could not be read"
        message="The saved content is damaged or not a valid note. It was left untouched to keep it safe."
        actionLabel="Retry"
        onAction={document.retry}
      />
    );
  }

  if (document.state.status === "error") {
    return (
      <NoteLoadError
        icon={<AlertTriangle className="size-5" />}
        title="Could not load this note"
        message={document.state.message}
        actionLabel="Retry"
        onAction={document.retry}
      />
    );
  }

  return (
    <>
      <PageSurface
        ref={pageRef}
        onDragEnter={handleNoteDragOver}
        onDragOver={handleNoteDragOver}
        onDrop={handleNoteDrop}
        className={`masar-note relative flex h-full flex-col${noteIsEmpty ? " masar-note-empty" : ""}`}
      >
        <NoteHeader
          board={board}
          readOnly={readOnly}
          status={autosave.status}
          lastSavedAt={autosave.lastSavedAt}
          offline={!online}
          outlineOpen={outlineOpen}
          onToggleOutline={() => setOutlineOpen((open) => !open)}
          onRetry={autosave.retry}
          onOpenSettings={() => setSettingsOpen(true)}
        />

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
          <NoteEditorSession
            editor={editor}
            readOnly={readOnly}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            noteWidth={noteWidth}
            onNoteWidthChange={setNoteWidth}
            outlineOpen={outlineOpen}
            onOutlineClose={() => setOutlineOpen(false)}
            handleEditorChange={autosave.handleEditorChange}
          />
        )}
        <ImageUploadDock uploads={uploads} onRetry={handleUploadRetry} />
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

function NoteLoadError({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          {icon}
        </span>
        <h1 className="font-display mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <Button className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
