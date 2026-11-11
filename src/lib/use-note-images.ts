import * as React from "react";

import type { BlockNoteEditor } from "@blocknote/core";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/client-api";
import {
  isImageStorageUnavailable,
  uploadImageFile,
  validateImageFile,
} from "@/lib/client-image";
import { blobToDataUrl } from "@/lib/whiteboard-image-hydration";

/**
 * Note image uploads for the editor session.
 *
 * `uploadNoteImage` uploads one image to Cloudflare R2 through the shared
 * image storage route (the same backend the whiteboard uses) and returns its
 * URL for the BlockNote image block. The bytes are retained in the local
 * image cache first, keyed by the remote image id, so the image survives
 * offline periods.
 *
 * When image storage is unavailable (the free local workspace, or a premium
 * session that cannot reach the API), the upload falls back to an embedded
 * data URL — BlockNote's default behaviour and the same arrangement as the
 * whiteboard, where the free workspace keeps embedded images.
 */
/**
 * Upload one image for a note and resolve its URL. See the module docs for
 * the storage/offline fallback arrangement. Exported for tests.
 */
export async function uploadNoteImage(
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

export interface NoteImageUploader {
  /**
   * BlockNote's upload callback. Stable across renders; always uploads to
   * the board the current session belongs to, and removes the placeholder
   * block BlockNote inserted when validation or storage rejects the file.
   */
  uploadFile(file: File, blockId?: string): Promise<string>;
}

export function useNoteImages(
  boardId: string,
  editorRef: React.RefObject<BlockNoteEditor | null>,
): NoteImageUploader {
  const boardIdRef = React.useRef(boardId);
  boardIdRef.current = boardId;

  const uploadFile = React.useCallback(
    async (file: File, blockId?: string) => {
      try {
        return await uploadNoteImage(boardIdRef.current, file);
      } catch (error) {
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
    [editorRef],
  );

  return { uploadFile };
}
