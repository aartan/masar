import * as React from "react";

import type { BlockNoteEditor } from "@blocknote/core";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/client-api";
import {
  isImageStorageUnavailable,
  uploadImageFile,
  validateImageFile,
} from "@/lib/client-image";
import type { ImageUploadProgress } from "@/lib/client-image";
import {
  useImageUploads,
  type ImageUploads,
} from "@/lib/use-image-uploads";
import { blobToDataUrl } from "@/lib/whiteboard-image-hydration";

/**
 * Note image uploads for the editor session.
 *
 * `uploadNoteImage` uploads one image to Cloudflare R2 through the shared
 * image storage route (the same backend the whiteboard uses) and returns its
 * URL for the BlockNote image block. The bytes are retained in the local
 * image cache, keyed by the remote image id, so the image survives offline
 * periods.
 *
 * When image storage is unavailable (the free local workspace, or a premium
 * session that cannot reach the API), the upload falls back to an embedded
 * data URL — BlockNote's default behaviour and the same arrangement as the
 * whiteboard, where the free workspace keeps embedded images. The caller is
 * told which happened so it can show a local-only state instead of silently
 * claiming the image reached R2.
 */

export type NoteImageProgressPhase =
  | "uploading"
  | "processing"
  | "caching"
  | "embedding";

export interface NoteImageProgress {
  phase: NoteImageProgressPhase;
  fraction: number | null;
}

export interface NoteImageUploadOptions {
  /** False in a free workspace, where an R2 upload is not available. */
  imageStorageAvailable?: boolean;
  /** Suppress user-facing toasts for background retries. */
  silent?: boolean;
  onProgress?: (progress: NoteImageProgress) => void;
  onStoredInCloud?: (stored: boolean) => void;
}

async function embedNoteImage(
  file: File,
  options: NoteImageUploadOptions,
): Promise<string> {
  options.onProgress?.({ phase: "embedding", fraction: null });
  const dataURL = await blobToDataUrl(file);
  options.onStoredInCloud?.(false);
  return dataURL;
}

/**
 * Upload one image for a note and resolve its URL. See the module docs for
 * the storage/offline fallback arrangement. Exported for tests.
 */
export async function uploadNoteImage(
  boardId: string,
  file: File,
  options: NoteImageUploadOptions = {},
): Promise<string> {
  const validation = await validateImageFile(file);
  if (!validation.ok) {
    if (!options.silent) {
      toast.error("Only image files can be added to notes", {
        description: `${file.name}: ${validation.message}`,
      });
    }
    throw new Error(validation.message);
  }
  const validatedFile = validation.file;

  if (options.imageStorageAvailable === false) {
    return embedNoteImage(validatedFile, options);
  }

  try {
    const { imageId } = await uploadImageFile(validatedFile, "note", {
      onProgress: (progress: ImageUploadProgress) =>
        options.onProgress?.({
          phase: progress.phase,
          fraction: progress.fraction,
        }),
    });

    // The R2 object exists from here on, even if the optional cache write
    // below fails.
    options.onStoredInCloud?.(true);

    options.onProgress?.({ phase: "caching", fraction: null });
    try {
      // Retain the bytes locally, keyed by the image id, so the note can
      // still render this image when the remote copy is unreachable.
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
      if (!options.silent) {
        toast.error("Could not add image", {
          description: errorMessage(error),
        });
      }
      throw error;
    }
    // Free workspace (or unavailable storage): embed the bytes instead of
    // losing the image. BlockNote renders data URLs natively.
    return embedNoteImage(validatedFile, options);
  }
}

export interface NoteImageUploader {
  /**
   * BlockNote's upload callback. Stable across renders; always uploads to
   * the board the current session belongs to, and removes the placeholder
   * block BlockNote inserted when validation or storage rejects the file.
   */
  uploadFile(file: File, blockId?: string): Promise<string>;
  /** Shared progress state for the floating upload dock. */
  uploads: ImageUploads;
}

export function useNoteImages(
  boardId: string,
  editorRef: React.RefObject<BlockNoteEditor | null>,
  options: { imageStorageAvailable?: boolean } = {},
): NoteImageUploader {
  const boardIdRef = React.useRef(boardId);
  boardIdRef.current = boardId;
  const imageStorageRef = React.useRef(options.imageStorageAvailable ?? true);
  imageStorageRef.current = options.imageStorageAvailable ?? true;
  const uploads = useImageUploads();
  const { start: startUpload, update: updateUpload, finish: finishUpload } =
    uploads;
  const sequenceRef = React.useRef(0);

  const uploadFile = React.useCallback(
    async (file: File, blockId?: string) => {
      const id = `note-${Date.now()}-${++sequenceRef.current}`;
      startUpload({ id, name: file.name || "Image" });
      // The user has committed to an upload. Show the indeterminate phase
      // immediately instead of waiting for the first network progress event.
      updateUpload(id, { phase: "uploading", progress: null });
      let storedInCloud = false;
      try {
        const url = await uploadNoteImage(boardIdRef.current, file, {
          imageStorageAvailable: imageStorageRef.current,
          onStoredInCloud: (stored) => {
            storedInCloud = stored;
          },
          onProgress: (progress) => {
            if (progress.phase === "uploading") {
              updateUpload(id, {
                phase: "uploading",
                progress: progress.fraction,
              });
            } else if (progress.phase === "processing") {
              updateUpload(id, { phase: "processing", progress: null });
            } else {
              updateUpload(id, { phase: "saving", progress: null });
            }
          },
        });

        if (storedInCloud) {
          finishUpload(id, "done", { autoDismissMs: 3_000 });
        } else {
          finishUpload(id, "local", {
            message: imageStorageRef.current
              ? "Cloud upload failed. Stored on this device."
              : "Stored on this device",
            retryable: imageStorageRef.current,
            autoDismissMs: imageStorageRef.current ? undefined : 4_000,
          });
        }
        return url;
      } catch (error) {
        finishUpload(id, "failed", { message: errorMessage(error) });
        // BlockNote inserts a placeholder block before invoking the upload
        // callback. Remove it when validation or storage rejects the file so
        // the note is not left with an empty, unusable block.
        if (blockId) {
          window.setTimeout(() => {
            const instance = editorRef.current;
            if (instance?.getBlock(blockId)) {
              instance.removeBlocks([blockId]);
            }
          }, 0);
        }
        throw error;
      }
    },
    [editorRef, startUpload, updateUpload, finishUpload],
  );

  return { uploadFile, uploads };
}
