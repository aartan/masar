import * as React from "react";

/**
 * Shared upload tracker for note, whiteboard and task images.
 *
 * The tracker is deliberately transport-agnostic: callers start an item,
 * report progress and finish it as stored in the cloud, kept on this device,
 * or failed. The note and whiteboard views render it in the shared upload
 * dock; the task attachment grid renders the same state inline.
 */

export type ImageUploadPhase =
  | "queued"
  | "uploading"
  | "processing"
  | "saving"
  | "done"
  | "local"
  | "failed";

export interface ImageUploadItem {
  id: string;
  name: string;
  phase: ImageUploadPhase;
  /** 0..1 while uploading, null when progress is indeterminate. */
  progress: number | null;
  message?: string;
  /** Whether a failed/local item can be retried by the current surface. */
  retryable: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface StartImageUploadInput {
  id: string;
  name: string;
  retryable?: boolean;
}

export interface UpdateImageUploadPatch {
  phase?: ImageUploadPhase;
  progress?: number | null;
  message?: string | null;
  retryable?: boolean;
}

export interface FinishImageUploadOptions {
  message?: string | null;
  retryable?: boolean;
  /** Auto-dismiss after this many milliseconds. Omitted means persistent. */
  autoDismissMs?: number;
}

export interface ImageUploads {
  items: ImageUploadItem[];
  start(input: StartImageUploadInput): void;
  update(id: string, patch: UpdateImageUploadPatch): void;
  finish(
    id: string,
    phase: "done" | "local" | "failed",
    options?: FinishImageUploadOptions,
  ): void;
  dismiss(id: string): void;
  clear(): void;
}

export function isActiveImageUpload(phase: ImageUploadPhase): boolean {
  return (
    phase === "queued" ||
    phase === "uploading" ||
    phase === "processing" ||
    phase === "saving"
  );
}

export function useImageUploads(): ImageUploads {
  const [items, setItems] = React.useState<ImageUploadItem[]>([]);
  const timers = React.useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  const clearTimer = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  React.useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  const start = React.useCallback(
    (input: StartImageUploadInput) => {
      clearTimer(input.id);
      setItems((current) => {
        const item: ImageUploadItem = {
          id: input.id,
          name: input.name,
          phase: "queued",
          progress: null,
          retryable: input.retryable ?? false,
          startedAt: Date.now(),
        };
        const existing = current.findIndex((entry) => entry.id === input.id);
        if (existing < 0) return [...current, item];
        const next = [...current];
        next[existing] = item;
        return next;
      });
    },
    [clearTimer],
  );

  const update = React.useCallback((id: string, patch: UpdateImageUploadPatch) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const { message, ...rest } = patch;
        const phase = rest.phase ?? item.phase;
        const active = isActiveImageUpload(phase);
        return {
          ...item,
          ...rest,
          phase,
          message:
            message === undefined ? item.message : (message ?? undefined),
          ...(active ? { finishedAt: undefined } : {}),
        };
      }),
    );
  }, []);

  const dismiss = React.useCallback(
    (id: string) => {
      clearTimer(id);
      setItems((current) => current.filter((item) => item.id !== id));
    },
    [clearTimer],
  );

  const clear = React.useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setItems([]);
  }, []);

  const finish = React.useCallback(
    (
      id: string,
      phase: "done" | "local" | "failed",
      options: FinishImageUploadOptions = {},
    ) => {
      clearTimer(id);
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                phase,
                progress: phase === "done" ? 1 : null,
                message: options.message ?? undefined,
                retryable: options.retryable ?? item.retryable,
                finishedAt: Date.now(),
              }
            : item,
        ),
      );
      if (options.autoDismissMs !== undefined && options.autoDismissMs > 0) {
        const timer = setTimeout(() => {
          timers.current.delete(id);
          setItems((current) => current.filter((item) => item.id !== id));
        }, options.autoDismissMs);
        timers.current.set(id, timer);
      }
    },
    [clearTimer],
  );

  return React.useMemo(
    () => ({ items, start, update, finish, dismiss, clear }),
    [items, start, update, finish, dismiss, clear],
  );
}
