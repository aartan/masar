"use client";

import * as React from "react";
import {
  Download,
  ImageOff,
  ImagePlus,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/client-api";
import {
  MAX_EMBEDDED_TASK_IMAGE_BYTES,
  MAX_TASK_IMAGES,
  TASK_IMAGE_ACCEPT,
  taskImageCacheUrl,
  taskImageThumbUrl,
  taskImageUrl,
  taskImageUrlId,
} from "@/lib/task-image";
import type { TaskImage } from "@/lib/types";
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

function uploadTaskImage(
  taskId: string,
  boardId: string,
  file: File,
): Promise<{ image: TaskImage; embedded: boolean }> {
  return (async () => {
    // Premium path: upload the bytes to R2 through the shared proxy, then
    // persist only the image id on the task.
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "task");
      const response = await fetch("/api/images", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Image upload failed (${response.status}).`);
      }
      const payload = (await response.json()) as {
        image?: { id?: string };
      };
      const imageId = payload.image?.id;
      if (!imageId) throw new Error("Image upload returned no id.");

      let created: TaskImage;
      try {
        const result = await api<{ image: TaskImage }>(
          `/api/tasks/${taskId}/images`,
          {
            method: "POST",
            body: JSON.stringify({ imageId, name: file.name }),
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
      try {
        const dataURL = await blobToDataUrl(file);
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
      if (file.size > MAX_EMBEDDED_TASK_IMAGE_BYTES) {
        throw new Error(
          "Image storage is unavailable and this file is too large to attach locally.",
        );
      }
      if (!file.type.startsWith("image/")) {
        throw new Error("Only image files can be attached.");
      }

      // Free workspace (or unavailable storage): embed the image as a data
      // URL, the same fallback Notes uses.
      const dataURL = await blobToDataUrl(file);
      try {
        const result = await api<{ image: TaskImage }>(
          `/api/tasks/${taskId}/images`,
          {
            method: "POST",
            body: JSON.stringify({ dataURL, name: file.name }),
          },
        );
        return { image: result.image, embedded: true };
      } catch (fallbackError) {
        // If the fallback was due to a transient premium failure, report the
        // original error, which is usually more actionable.
        if (error instanceof Error && !(fallbackError instanceof Error)) {
          throw error;
        }
        throw fallbackError;
      }
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
  const [pending, setPending] = React.useState<string[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const [preview, setPreview] = React.useState<TaskImage | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const canAdd = !readOnly && images.length + pending.length < MAX_TASK_IMAGES;

  async function addFiles(files: File[]) {
    if (!files.length || readOnly) return;
    const available = MAX_TASK_IMAGES - imagesRef.current.length;
    const accepted = files.slice(0, Math.max(0, available));
    if (accepted.length < files.length) {
      toast.error(`A task can have at most ${MAX_TASK_IMAGES} images.`);
    }

    for (const file of accepted) {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files can be attached", {
          description: file.name,
        });
        continue;
      }
      setPending((current) => [...current, file.name]);
      try {
        const { image, embedded } = await uploadTaskImage(
          taskId,
          boardId,
          file,
        );
        const next = [...imagesRef.current, image];
        imagesRef.current = next;
        onImagesChange(next);
        if (embedded) {
          toast.info("Image attached locally", {
            description:
              "Sign in to premium sync to store new images in the cloud.",
          });
        }
      } catch (error) {
        toast.error("Could not attach image", {
          description: errorMessage(error),
        });
      } finally {
        setPending((current) => {
          const index = current.indexOf(file.name);
          return index < 0
            ? current
            : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
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
              accept={TASK_IMAGE_ACCEPT}
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
              {pending.length > 0 ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {pending.length > 0 ? "Uploading…" : "Add image"}
            </Button>
          </>
        )}
      </div>

      {images.length === 0 && pending.length === 0 ? (
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
          {pending.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className="grid aspect-square place-items-center rounded-lg border border-dashed border-border/70 bg-muted/30"
              aria-label={`Uploading ${name}`}
            >
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
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
