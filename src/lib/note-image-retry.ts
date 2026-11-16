import type { BlockNoteEditor } from "@blocknote/core";

import { errorMessage } from "@/lib/client-api";
import {
  dataUrlToFile,
  embeddedImageFileName,
  isSupportedImageDataUrl,
} from "@/lib/client-image";
import {
  isActiveImageUpload,
  type ImageUploads,
} from "@/lib/use-image-uploads";
import { uploadNoteImage } from "@/lib/use-note-images";

/**
 * Recovery for note images that were persisted as embedded data URLs (the
 * free/offline fallback, an imported note, or a transient premium failure).
 * The dock exposes a Retry action; uploading here replaces the data URL with
 * the canonical R2-backed `/api/images/<id>` URL and lets autosave persist it.
 */

interface EmbeddedNoteImage {
  blockId: string;
  url: string;
}

export function noteEmbeddedImageUploadId(blockId: string): string {
  return `embedded-note-${blockId}`;
}

function collectEmbeddedImages(
  editor: BlockNoteEditor,
): EmbeddedNoteImage[] {
  const found: EmbeddedNoteImage[] = [];
  const visitBlocks = (blocks: readonly unknown[]): void => {
    for (const value of blocks) {
      if (!value || typeof value !== "object") continue;
      const block = value as {
        id?: unknown;
        type?: unknown;
        props?: Record<string, unknown>;
        children?: unknown[];
        content?: unknown;
      };
      const url = block.props?.url;
      if (
        block.type === "image" &&
        typeof block.id === "string" &&
        isSupportedImageDataUrl(url)
      ) {
        found.push({ blockId: block.id, url });
      }
      if (Array.isArray(block.children)) visitBlocks(block.children);
      // Table cells and other nested content can carry block-shaped records.
      if (Array.isArray(block.content)) visitBlocks(block.content);
    }
  };
  visitBlocks(editor.document);
  return found;
}

/**
 * Register existing embedded images as local-only dock items. This is
 * idempotent and only runs when premium storage is available; in a free
 * workspace embedded images are the expected permanent state.
 */
export function registerEmbeddedNoteImages(
  editor: BlockNoteEditor,
  uploads: ImageUploads,
  registered: Set<string>,
): void {
  for (const image of collectEmbeddedImages(editor)) {
    const id = noteEmbeddedImageUploadId(image.blockId);
    if (registered.has(id)) continue;
    const existing = uploads.items.find((item) => item.id === id);
    registered.add(id);
    if (existing) continue;
    uploads.start({ id, name: "Embedded image", retryable: true });
    uploads.finish(id, "local", {
      message: "Stored on this device. Upload to cloud storage.",
      retryable: true,
    });
  }
}

function dataUrlContentType(url: string): string {
  const comma = url.indexOf(",");
  if (comma < 5) return "image/png";
  return url.slice(5, comma).split(";", 1)[0] || "image/png";
}

/**
 * Upload every embedded note image with premium storage available. Blocks
 * sharing the same data URL are uploaded once and all rewritten together.
 */
export async function retryEmbeddedNoteImages({
  editor,
  boardId,
  uploads,
}: {
  editor: BlockNoteEditor;
  boardId: string;
  uploads: ImageUploads;
}): Promise<void> {
  const images = collectEmbeddedImages(editor);
  if (images.length === 0) return;

  const byUrl = new Map<string, EmbeddedNoteImage[]>();
  for (const image of images) {
    const group = byUrl.get(image.url) ?? [];
    group.push(image);
    byUrl.set(image.url, group);
  }

  for (const [url, group] of byUrl) {
    const ids = group.map((image) =>
      noteEmbeddedImageUploadId(image.blockId),
    );
    if (
      ids.some((id) => {
        const item = uploads.items.find((entry) => entry.id === id);
        return item !== undefined && isActiveImageUpload(item.phase);
      })
    ) {
      continue;
    }

    for (const id of ids) {
      if (!uploads.items.some((item) => item.id === id)) {
        uploads.start({ id, name: "Embedded image", retryable: true });
      }
      uploads.update(id, { phase: "queued", progress: null, message: null });
    }

    try {
      const file = await dataUrlToFile(
        url,
        embeddedImageFileName(dataUrlContentType(url)),
      );
      let storedInCloud = false;
      const canonicalUrl = await uploadNoteImage(boardId, file, {
        imageStorageAvailable: true,
        silent: true,
        onStoredInCloud: (stored) => {
          storedInCloud = stored;
        },
        onProgress: (progress) => {
          for (const id of ids) {
            if (progress.phase === "uploading") {
              uploads.update(id, {
                phase: "uploading",
                progress: progress.fraction,
              });
            } else if (progress.phase === "processing") {
              uploads.update(id, { phase: "processing", progress: null });
            } else {
              uploads.update(id, { phase: "saving", progress: null });
            }
          }
        },
      });

      if (!storedInCloud) {
        for (const id of ids) {
          uploads.finish(id, "local", {
            message: "Still stored on this device.",
            retryable: true,
          });
        }
        continue;
      }

      for (const image of group) {
        if (editor.getBlock(image.blockId)) {
          editor.updateBlock(image.blockId, {
            props: { url: canonicalUrl },
          });
        }
      }
      for (const id of ids) {
        uploads.finish(id, "done", {
          message: "Uploaded to cloud storage",
          autoDismissMs: 3_000,
        });
      }
    } catch (error) {
      for (const id of ids) {
        uploads.finish(id, "failed", {
          message: errorMessage(error),
          retryable: true,
        });
      }
    }
  }

  // A fallback image may have been tracked under the original insertion id
  // rather than the per-block embedded id. Once no embedded blocks remain,
  // those local items are stale; clear them with the successful uploads.
  if (collectEmbeddedImages(editor).length === 0) {
    for (const item of uploads.items) {
      if (item.phase === "local") {
        uploads.finish(item.id, "done", { autoDismissMs: 3_000 });
      }
    }
  }
}
