"use client";

import * as React from "react";
import {
  AlertTriangle,
  CloudOff,
  CloudUpload,
  Download,
  ImageOff,
  ImagePlus,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ClientApiError, errorMessage } from "@/lib/client-api";
import {
  dataUrlToFile,
  embeddedImageFileName,
  isImageStorageUnavailable,
  uploadImageFile,
  validateImageFile,
} from "@/lib/client-image";
import { IMAGE_ACCEPT } from "@/lib/image-file";
import {
  isImageDataUrl,
  MAX_EMBEDDED_TASK_IMAGE_BYTES,
  MAX_TASK_IMAGES,
  taskImageCacheUrl,
  taskImageThumbUrl,
  taskImageUrl,
  taskImageUrlId,
} from "@/lib/task-image";
import type { TaskImage } from "@/lib/types";
import {
  isActiveImageUpload,
  useImageUploads,
} from "@/lib/use-image-uploads";
import { useOnline } from "@/lib/use-online";
import { blobToDataUrl } from "@/lib/whiteboard-image-hydration";
import { cn } from "@/lib/utils";

type ImageStage = "cache" | "thumb" | "original" | "failed";

/**
 * Render a task image with an offline-first source chain:
 * local cache → remote thumbnail → remote original. Embedded data URLs from
 * the free workspace render directly.
 */
function TaskImageSource({
  boardId,
  image,
  variant,
  className,
}: {
  boardId: string;
  image: TaskImage;
  variant: "thumb" | "original";
  className?: string;
}) {
  const imageId = taskImageUrlId(image.url);
  const [stage, setStage] = React.useState<ImageStage>(
    imageId ? "cache" : "original",
  );

  React.useEffect(() => {
    setStage(imageId ? "cache" : "original");
  }, [image.url, imageId]);

  if (!imageId) {
    return (
      <img
        src={image.url}
        alt={image.name ?? "Task image"}
        className={className}
      />
    );
  }

  if (stage === "failed") {
    return (
      <div
        className={cn(
          "grid h-full w-full place-items-center bg-muted/60 text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  const src =
    stage === "cache"
      ? taskImageCacheUrl(boardId, imageId)
      : stage === "thumb" && variant === "thumb"
        ? taskImageThumbUrl(imageId)
        : taskImageUrl(imageId);

  return (
    <img
      src={src}
      alt={image.name ?? "Task image"}
      className={className}
      onError={() => {
        setStage((current) => {
          if (current === "cache") {
            return variant === "thumb" ? "thumb" : "original";
          }
          if (current === "thumb") return "original";
          return "failed";
        });
      }}
    />
  );
}

export type TaskImageProgressPhase =
  | "uploading"
  | "processing"
  | "caching"
  | "embedding";

export interface TaskImageUploadOptions {
  /** False in a free workspace, where R2 is not configured. */
  imageStorageAvailable?: boolean;
  onProgress?: (progress: {
    phase: TaskImageProgressPhase;
    fraction: number | null;
  }) => void;
}

async function attachEmbeddedTaskImage(
  taskId: string,
  file: File,
  options: TaskImageUploadOptions,
): Promise<TaskImage> {
  if (file.size > MAX_EMBEDDED_TASK_IMAGE_BYTES) {
    throw new Error(
      "Image storage is unavailable and this file is too large to attach locally.",
    );
  }
  options.onProgress?.({ phase: "embedding", fraction: null });
  const dataURL = await blobToDataUrl(file);
  const result = await api<{ image: TaskImage }>(
    `/api/tasks/${taskId}/images`,
    {
      method: "POST",
      body: JSON.stringify({ dataURL, name: file.name }),
    },
  );
  return result.image;
}

function uploadTaskImage(
  taskId: string,
  boardId: string,
  file: File,
  options: TaskImageUploadOptions = {},
): Promise<{ image: TaskImage; embedded: boolean }> {
  return (async () => {
    const validation = await validateImageFile(file);
    if (!validation.ok) throw new Error(validation.message);
    const validatedFile = validation.file;

    if (options.imageStorageAvailable === false) {
      return {
        image: await attachEmbeddedTaskImage(taskId, validatedFile, options),
        embedded: true,
      };
    }

    // Premium path: upload the bytes to R2 through the shared proxy, then
    // persist only the image id on the task.
    try {
      const { imageId } = await uploadImageFile(validatedFile, "task", {
        onProgress: (progress) =>
          options.onProgress?.({
            phase: progress.phase,
            fraction: progress.fraction,
          }),
      });

      let created: TaskImage;
      try {
        const result = await api<{ image: TaskImage }>(
          `/api/tasks/${taskId}/images`,
          {
            method: "POST",
            body: JSON.stringify({ imageId, name: validatedFile.name }),
          },
        );
        created = result.image;
      } catch (error) {
        // The upload succeeded but the attachment row did not; do not leave an
        // unreachable R2 object behind.
        try {
          await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
            method: "DELETE",
            cache: "no-store",
          });
        } catch {
          /* Best effort. */
        }
        throw error;
      }

      // Retain a local copy so the attachment still renders offline. The
      // remote copy already exists, so a cache failure is not fatal.
      options.onProgress?.({ phase: "caching", fraction: null });
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
        /* The remote copy is the durable source. */
      }

      return { image: created, embedded: false };
    } catch (error) {
      const canEmbed =
        isImageStorageUnavailable(error) ||
        (error instanceof ClientApiError &&
          error.status === 413 &&
          validatedFile.size <= MAX_EMBEDDED_TASK_IMAGE_BYTES);
      if (!canEmbed) throw error;

      // Free workspace (or unavailable storage): embed the image as a data
      // URL, the same fallback Notes uses.
      return {
        image: await attachEmbeddedTaskImage(taskId, validatedFile, options),
        embedded: true,
      };
    }
  })();
}

export function TaskImagesSection({
  taskId,
  boardId,
  images,
  readOnly = false,
  onImagesChange,
}: {
  taskId: string;
  boardId: string;
  images: TaskImage[];
  readOnly?: boolean;
  onImagesChange: (images: TaskImage[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const imagesRef = React.useRef(images);
  const { imageStorage } = useWorkspace();
  const online = useOnline();
  const uploads = useImageUploads();
  const {
    start: startUpload,
    update: updateUpload,
    finish: finishUpload,
    dismiss: dismissUpload,
    clear: clearUploads,
  } = uploads;
  const retryFilesRef = React.useRef(new Map<string, File>());
  const uploadSequenceRef = React.useRef(0);
  const [dragActive, setDragActive] = React.useState(false);
  const [preview, setPreview] = React.useState<TaskImage | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const taskIdRef = React.useRef(taskId);
  taskIdRef.current = taskId;
  const previousTaskIdRef = React.useRef(taskId);

  React.useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  React.useEffect(() => {
    if (previousTaskIdRef.current === taskId) return;
    previousTaskIdRef.current = taskId;
    clearUploads();
    retryFilesRef.current.clear();
    setPreview(null);
    setRemovingId(null);
  }, [taskId, clearUploads]);

  const activeUploads = uploads.items.filter((item) =>
    isActiveImageUpload(item.phase),
  );
  const failedUploads = uploads.items.filter(
    (item) => item.phase === "failed",
  );
  const canAdd =
    !readOnly && images.length + activeUploads.length < MAX_TASK_IMAGES;
  const embeddedImages = images.filter((image) => isImageDataUrl(image.url));
  const canRetryEmbedded =
    imageStorage && !readOnly && online && embeddedImages.length > 0;

  function updateProgress(
    id: string,
    progress: {
      phase: "uploading" | "processing" | "caching" | "embedding";
      fraction: number | null;
    },
  ): void {
    if (progress.phase === "uploading") {
      updateUpload(id, { phase: "uploading", progress: progress.fraction });
    } else if (progress.phase === "processing") {
      updateUpload(id, { phase: "processing", progress: null });
    } else {
      updateUpload(id, { phase: "saving", progress: null });
    }
  }

  async function runUpload(id: string, file: File): Promise<void> {
    const requestTaskId = taskId;
    try {
      const { image, embedded } = await uploadTaskImage(
        requestTaskId,
        boardId,
        file,
        {
          imageStorageAvailable: imageStorage,
          onProgress: (progress) => updateProgress(id, progress),
        },
      );
      if (taskIdRef.current !== requestTaskId) {
        // The sheet moved to another task while this upload finished. The
        // attachment belongs to the previous task; never merge it into the
        // new task's list.
        return;
      }
      const next = [...imagesRef.current, image];
      imagesRef.current = next;
      onImagesChange(next);
      if (embedded) {
        // The attachment exists as a data URL. The image tile's cloud-off
        // badge and the section banner offer the in-place cloud promotion;
        // re-running this upload would create a duplicate attachment.
        retryFilesRef.current.delete(id);
        finishUpload(id, "local", {
          message: imageStorage
            ? "Cloud upload failed. Stored on this device."
            : "Stored on this device",
          retryable: false,
          autoDismissMs: 5_000,
        });
      } else {
        retryFilesRef.current.delete(id);
        finishUpload(id, "done", { autoDismissMs: 3_000 });
      }
    } catch (error) {
      if (taskIdRef.current !== requestTaskId) return;
      retryFilesRef.current.set(id, file);
      finishUpload(id, "failed", {
        message: errorMessage(error),
        retryable: true,
      });
      toast.error("Could not attach image", {
        description: errorMessage(error),
      });
    }
  }

  async function addFiles(files: File[]) {
    if (!files.length || readOnly) return;
    const available =
      MAX_TASK_IMAGES - imagesRef.current.length - activeUploads.length;
    const accepted = files.slice(0, Math.max(0, available));
    if (accepted.length < files.length) {
      toast.error(`A task can have at most ${MAX_TASK_IMAGES} images.`);
    }

    const jobs: Array<{ id: string; file: File }> = [];
    for (const file of accepted) {
      const validation = await validateImageFile(file);
      if (!validation.ok) {
        toast.error("Only image files can be attached", {
          description: `${file.name}: ${validation.message}`,
        });
        continue;
      }
      const id = `task-${Date.now()}-${++uploadSequenceRef.current}`;
      retryFilesRef.current.set(id, validation.file);
      startUpload({ id, name: file.name || "Image", retryable: true });
      updateUpload(id, { phase: "uploading", progress: null });
      jobs.push({ id, file: validation.file });
    }

    for (const job of jobs) {
      await runUpload(job.id, job.file);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function retryFailedUpload(id: string): void {
    if (id.startsWith("task-embedded-")) {
      void retryEmbeddedImages();
      return;
    }
    const file = retryFilesRef.current.get(id);
    if (!file || readOnly) return;
    updateUpload(id, {
      phase: "uploading",
      progress: null,
      message: null,
      retryable: true,
    });
    void runUpload(id, file);
  }

  /**
   * Promote embedded attachments to R2 without changing their order. The
   * server updates every attachment row sharing the old data URL, which also
   * keeps duplicated tasks in sync.
   */
  async function retryEmbeddedImages(): Promise<void> {
    if (!canRetryEmbedded) return;
    const requestTaskId = taskId;

    const groups = new Map<string, TaskImage[]>();
    for (const image of imagesRef.current) {
      if (!isImageDataUrl(image.url)) continue;
      const group = groups.get(image.url) ?? [];
      group.push(image);
      groups.set(image.url, group);
    }

    for (const [dataUrl, group] of groups) {
      const first = group[0];
      if (!first) continue;
      const id = `task-embedded-${first.id}`;
      const existing = uploads.items.find((item) => item.id === id);
      if (existing && isActiveImageUpload(existing.phase)) continue;
      if (!existing) {
        startUpload({
          id,
          name: first.name ?? "Embedded image",
          retryable: true,
        });
      }
      updateUpload(id, {
        phase: "uploading",
        progress: null,
        message: null,
        retryable: true,
      });

      let uploadedImageId: string | null = null;
      try {
        const comma = dataUrl.indexOf(",");
        const contentType =
          comma > 5
            ? dataUrl.slice(5, comma).split(";", 1)[0] || "image/png"
            : "image/png";
        const file = await dataUrlToFile(
          dataUrl,
          embeddedImageFileName(contentType),
        );
        const uploaded = await uploadImageFile(file, "task", {
          onProgress: (progress) =>
            updateProgress(id, {
              phase: progress.phase,
              fraction: progress.fraction,
            }),
        });
        uploadedImageId = uploaded.imageId;

        updateUpload(id, { phase: "saving", progress: null });
        try {
          const cached = await blobToDataUrl(uploaded.file);
          await api(
            `/api/boards/${boardId}/images/${encodeURIComponent(uploaded.imageId)}/cache`,
            {
              method: "PUT",
              body: JSON.stringify({ dataURL: cached }),
            },
          );
        } catch {
          /* The remote copy is durable; the cache is a fallback. */
        }

        const result = await api<{ url: string; updated: number }>(
          `/api/tasks/${requestTaskId}/images/${first.id}/reupload`,
          {
            method: "POST",
            body: JSON.stringify({ imageId: uploaded.imageId }),
          },
        );
        // Another sheet or device may have promoted the shared data URL while
        // this upload was running. The server keeps the existing reference;
        // discard the object this request uploaded.
        if (
          result.updated === 0 &&
          result.url !== `/api/images/${uploaded.imageId}`
        ) {
          try {
            await fetch(
              `/api/images/${encodeURIComponent(uploaded.imageId)}`,
              { method: "DELETE", cache: "no-store" },
            );
          } catch {
            /* Best effort. */
          }
        }
        if (taskIdRef.current !== requestTaskId) continue;
        const next = imagesRef.current.map((image) =>
          image.url === dataUrl ? { ...image, url: result.url } : image,
        );
        imagesRef.current = next;
        onImagesChange(next);
        setPreview((current) =>
          current && current.url === dataUrl
            ? { ...current, url: result.url }
            : current,
        );
        finishUpload(id, "done", { autoDismissMs: 3_000 });
      } catch (error) {
        if (uploadedImageId) {
          try {
            await fetch(
              `/api/images/${encodeURIComponent(uploadedImageId)}`,
              { method: "DELETE", cache: "no-store" },
            );
          } catch {
            /* Best effort. */
          }
        }
        finishUpload(id, "failed", {
          message: errorMessage(error),
          retryable: true,
        });
      }
    }
  }

  async function removeImage(image: TaskImage) {
    if (readOnly || removingId) return;
    setRemovingId(image.id);
    try {
      await api(`/api/tasks/${taskId}/images/${image.id}`, {
        method: "DELETE",
      });
      const next = imagesRef.current.filter((item) => item.id !== image.id);
      imagesRef.current = next;
      onImagesChange(next);
      if (preview?.id === image.id) setPreview(null);
      toast.success("Image removed");
    } catch (error) {
      toast.error("Could not remove image", {
        description: errorMessage(error),
      });
    } finally {
      setRemovingId(null);
    }
  }

  const previewId = preview ? taskImageUrlId(preview.url) : null;

  return (
    <section
      className={cn(
        "mt-6 rounded-lg border border-transparent transition-colors",
        dragActive && !readOnly && "border-primary/40 bg-primary/5",
      )}
      onDragOver={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setDragActive(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Images
          {images.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tracking-normal text-muted-foreground">
              {images.length}
            </span>
          )}
        </h3>
        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) =>
                void addFiles(Array.from(event.target.files ?? []))
              }
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
              disabled={!canAdd}
              onClick={() => inputRef.current?.click()}
            >
              {activeUploads.length > 0 ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {activeUploads.length > 0 ? "Uploading…" : "Add image"}
            </Button>
          </>
        )}
      </div>

      {!readOnly && imageStorage && embeddedImages.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {embeddedImages.length} image
            {embeddedImages.length === 1 ? " is" : "s are"} stored on this
            device.
          </span>
          <button
            type="button"
            disabled={!canRetryEmbedded}
            onClick={() => void retryEmbeddedImages()}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[10.5px] font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={online ? undefined : "Reconnect to upload images"}
          >
            <CloudUpload className="size-3" />
            Upload to cloud
          </button>
        </div>
      )}

      {!readOnly && !imageStorage && embeddedImages.length > 0 && (
        <p className="mt-2 text-[10.5px] text-muted-foreground">
          Images are stored on this device. Premium sync stores them in the
          cloud.
        </p>
      )}

      {images.length === 0 &&
      activeUploads.length === 0 &&
      failedUploads.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {readOnly
            ? "No images attached."
            : "Attach screenshots, references, or other images. Drag and drop works too."}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {images.map((image) => (
            <li
              key={image.id}
              className="group/image relative aspect-square overflow-hidden rounded-lg border border-border/70 bg-muted/40"
            >
              <button
                type="button"
                onClick={() => setPreview(image)}
                className="block h-full w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Preview ${image.name ?? "task image"}`}
              >
                <TaskImageSource
                  boardId={boardId}
                  image={image}
                  variant="thumb"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover/image:scale-[1.03]"
                />
              </button>
              {isImageDataUrl(image.url) && (
                <span
                  className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white"
                  title="Stored on this device"
                >
                  <CloudOff className="size-2.5" />
                  Local
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void removeImage(image)}
                  disabled={removingId === image.id}
                  className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md bg-black/55 text-white opacity-100 transition-opacity hover:bg-destructive disabled:opacity-60 sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
                  aria-label={`Remove ${image.name ?? "task image"}`}
                >
                  {removingId === image.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </button>
              )}
            </li>
          ))}
          {activeUploads.map((item) => (
            <li
              key={item.id}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-muted/30 px-2 text-center"
              aria-label={`Uploading ${item.name}`}
            >
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="line-clamp-2 text-[9.5px] leading-tight text-muted-foreground">
                {item.name}
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-[width] duration-200",
                    item.progress === null && "w-1/3 animate-pulse",
                  )}
                  style={
                    item.progress === null
                      ? undefined
                      : { width: `${Math.round(item.progress * 100)}%` }
                  }
                />
              </div>
            </li>
          ))}
          {failedUploads.map((item) => (
            <li
              key={item.id}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-1.5 text-center"
              aria-label={`Upload failed for ${item.name}`}
            >
              <AlertTriangle className="size-4 text-destructive" />
              <span className="line-clamp-2 text-[9.5px] leading-tight text-muted-foreground">
                {item.message ?? "Upload failed"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => retryFailedUpload(item.id)}
                  className="inline-flex h-5 items-center gap-0.5 rounded border border-border bg-background px-1 text-[9px] font-medium"
                >
                  <RefreshCw className="size-2.5" />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismissUpload(item.id);
                    retryFilesRef.current.delete(item.id);
                  }}
                  aria-label={`Dismiss upload for ${item.name}`}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl gap-3 p-4 sm:p-5">
          {preview && (
            <>
              <DialogHeader className="pr-10">
                <DialogTitle className="truncate text-[14px]">
                  {preview.name ?? "Task image"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Full-size task image preview.
                </DialogDescription>
              </DialogHeader>
              <div className="grid max-h-[70vh] place-items-center overflow-hidden rounded-lg bg-muted/40">
                <TaskImageSource
                  boardId={boardId}
                  image={preview}
                  variant="original"
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                />
              </div>
              <DialogFooter className="items-center justify-between sm:justify-between">
                <span className="text-[10.5px] text-muted-foreground">
                  {previewId ? "Stored in premium image storage" : "Stored locally"}
                </span>
                <a
                  href={
                    previewId ? taskImageUrl(previewId) : preview.url
                  }
                  download={preview.name ?? "task-image"}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11.5px] font-medium transition-colors hover:bg-accent"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
