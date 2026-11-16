import {
  AlertTriangle,
  Check,
  CloudOff,
  ImageIcon,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import {
  isActiveImageUpload,
  type ImageUploadItem,
  type ImageUploads,
} from "@/lib/use-image-uploads";
import { cn } from "@/lib/utils";

/**
 * Floating progress dock for image uploads. It sits bottom-left so it never
 * competes with the toast stack (bottom-right) and stays visible while the
 * user keeps working. Successful uploads dismiss themselves; local-only and
 * failed uploads stay until dismissed or retried.
 */
export function ImageUploadDock({
  uploads,
  onRetry,
}: {
  uploads: ImageUploads;
  onRetry?: (item: ImageUploadItem) => void;
}) {
  const items = uploads.items;
  if (items.length === 0) return null;

  const active = items.filter((item) => isActiveImageUpload(item.phase));
  const failed = items.filter((item) => item.phase === "failed");
  const local = items.filter((item) => item.phase === "local");
  const done = items.filter((item) => item.phase === "done");

  const verb = active.some(
    (item) => item.phase === "uploading" || item.phase === "processing",
  )
    ? "Uploading"
    : active.some((item) => item.phase === "saving")
      ? "Saving"
      : "Preparing";
  const headline =
    active.length > 0
      ? `${verb} ${active.length} image${active.length === 1 ? "" : "s"}…`
      : failed.length > 0
        ? `Couldn’t upload ${failed.length} image${failed.length === 1 ? "" : "s"}`
        : local.length > 0
          ? `${local.length} image${local.length === 1 ? " is" : "s are"} stored on this device`
          : `${done.length} image${done.length === 1 ? "" : "s"} uploaded`;

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-4 z-40 flex w-[min(21rem,calc(100vw-2rem))] flex-col"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto overflow-hidden rounded-xl border border-border/80 bg-popover/95 text-popover-foreground shadow-float backdrop-blur"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          {active.length > 0 ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          ) : failed.length > 0 ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : local.length > 0 ? (
            <CloudOff className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Check className="size-4 shrink-0 text-success" />
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
            {headline}
          </span>
        </div>

        <ul className="max-h-64 overflow-y-auto scrollbar-thin">
          {items.map((item) => (
            <ImageUploadRow
              key={item.id}
              item={item}
              onDismiss={() => uploads.dismiss(item.id)}
              onRetry={onRetry}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ImageUploadRow({
  item,
  onDismiss,
  onRetry,
}: {
  item: ImageUploadItem;
  onDismiss: () => void;
  onRetry?: (item: ImageUploadItem) => void;
}) {
  const active = isActiveImageUpload(item.phase);
  const failed = item.phase === "failed";
  const local = item.phase === "local";
  const retryable = (failed || local) && item.retryable && onRetry !== undefined;

  return (
    <li className="border-b border-border/40 px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground",
            failed && "bg-destructive/10 text-destructive",
            item.phase === "done" && "bg-success/10 text-success",
          )}
        >
          {active ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : failed ? (
            <AlertTriangle className="size-3.5" />
          ) : local ? (
            <CloudOff className="size-3.5" />
          ) : item.phase === "done" ? (
            <Check className="size-3.5" />
          ) : (
            <ImageIcon className="size-3.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[12px] font-medium">
              {item.name}
            </p>
            {retryable && (
              <button
                type="button"
                onClick={() => onRetry?.(item)}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <RefreshCw className="size-3" />
                Retry
              </button>
            )}
            {!active && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={`Dismiss ${item.name}`}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <p
            className={cn(
              "truncate text-[10.5px] text-muted-foreground",
              failed && "text-destructive/90",
            )}
          >
            {uploadStatusLabel(item)}
          </p>
          {active && (
            <div
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`Uploading ${item.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                item.progress === null
                  ? undefined
                  : Math.round(item.progress * 100)
              }
            >
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
          )}
        </div>
      </div>
    </li>
  );
}

function uploadStatusLabel(item: ImageUploadItem): string {
  switch (item.phase) {
    case "queued":
      return "Preparing…";
    case "uploading":
      return item.progress === null
        ? "Uploading…"
        : `Uploading… ${Math.round(item.progress * 100)}%`;
    case "processing":
      return "Processing image…";
    case "saving":
      return "Saving on this device…";
    case "done":
      return "Uploaded to cloud storage";
    case "local":
      return item.message ?? "Stored on this device";
    case "failed":
      return item.message ?? "Upload failed";
  }
}
