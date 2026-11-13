import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Laptop,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { PageSurface } from "@/components/layout/page-surface";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { api, errorMessage } from "@/lib/client-api";
import {
  buildConflictDiff,
  diffText,
  type ConflictDiffRow,
  type ConflictLookup,
} from "@/lib/conflict-diff";
import { formatDateTime } from "@/lib/dates";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { BoardDetail, SyncConflictView } from "@/lib/types";

type Choice = "cloud" | "local";

const TYPE_LABEL: Record<SyncConflictView["entityType"], string> = {
  project: "Project",
  folder: "Folder",
  board: "Space",
  column: "Column",
  task: "Task",
  label: "Label",
  task_label: "Task label",
  subtask: "Subtask",
  comment: "Comment",
  whiteboard: "Whiteboard",
  note: "Note",
  task_image: "Task image",
};

export function ConflictsPage() {
  const { refresh, projects, folders } = useWorkspace();
  const bridge = window.masarDesktop;
  const [conflicts, setConflicts] = React.useState<SyncConflictView[]>([]);
  const [boardLookups, setBoardLookups] = React.useState<
    Record<string, { columns: Map<string, string>; labels: Map<string, string> }>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState<Choice | null>(null);
  const showSkeleton = useDelayedLoading(loading);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api<{ conflicts: SyncConflictView[] }>(
        "/api/sync/conflicts",
      );
      setConflicts(data.conflicts);
      if (silent) setError(null);
    } catch (caught) {
      if (!silent) {
        setError(
          caught instanceof Error ? caught.message : "Could not load conflicts.",
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  useOnSyncComplete(() => {
    void load(true);
  });

  const boardIds = React.useMemo(
    () =>
      Array.from(
        new Set(
          conflicts
            .map((conflict) => conflict.boardId)
            .filter((id): id is string => Boolean(id)),
        ),
      ).sort(),
    [conflicts],
  );
  React.useEffect(() => {
    let active = true;
    if (boardIds.length === 0) {
      setBoardLookups({});
      return;
    }
    void Promise.all(
      boardIds.map(async (boardId) => {
        try {
          const data = await api<{ board: BoardDetail }>(
            `/api/boards/${boardId}`,
          );
          return [
            boardId,
            {
              columns: new Map(
                data.board.columns.map((column) => [column.id, column.name]),
              ),
              labels: new Map(
                data.board.labels.map((label) => [label.id, label.name]),
              ),
            },
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setBoardLookups(
        Object.fromEntries(
          entries.filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          ),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [boardIds]);

  const projectMap = React.useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const folderMap = React.useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  function lookupFor(conflict: SyncConflictView): ConflictLookup {
    const board = conflict.boardId
      ? boardLookups[conflict.boardId]
      : undefined;
    return {
      columns: board?.columns ?? new Map(),
      labels: board?.labels ?? new Map(),
      projects: projectMap,
      folders: folderMap,
    };
  }

  async function resolveAll(choice: Choice) {
    if (!bridge || bulkBusy) return;
    setBulkBusy(choice);
    let completed = 0;
    let failed = 0;
    try {
      for (const conflict of conflicts) {
        try {
          await bridge.resolveSyncConflict(conflict.id, choice);
          completed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed === 0) {
        toast.success(
          choice === "cloud"
            ? "All conflicts kept the cloud version"
            : "All conflicts kept this device’s version",
          { description: `${completed} resolved.` },
        );
      } else {
        toast.warning("Some conflicts could not be resolved", {
          description: `${completed} resolved, ${failed} still need attention.`,
        });
      }
      await Promise.all([load(true), refresh()]);
    } finally {
      setBulkBusy(null);
    }
  }

  async function resolve(conflict: SyncConflictView, choice: Choice) {
    if (!bridge) {
      toast.error("Conflict resolution requires the desktop app.");
      return;
    }
    const key = `${conflict.id}:${choice}`;
    setBusy(key);
    try {
      await bridge.resolveSyncConflict(conflict.id, choice);
      toast.success(
        choice === "cloud" ? "Cloud version kept" : "This device’s version kept",
      );
      await Promise.all([load(true), refresh()]);
    } catch (caught) {
      toast.error("Could not resolve conflict", {
        description: errorMessage(caught),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageSurface scroll>
      <div className="mx-auto w-full max-w-[1000px] px-5 py-8 sm:px-8">
        <header>
          <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Sync
          </p>
          <h1 className="font-display mt-2 text-[26px] font-semibold">
            Sync conflicts
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            These changes were made on different devices before the workspace
            could catch up. Choose which version to keep for each item.
          </p>
        </header>

        {!loading && conflicts.length > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3">
            <p className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {conflicts.length} conflicts
              </span>{" "}
              need a decision. You can resolve each one or apply the same choice
              to all.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy !== null}
                onClick={() => void resolveAll("local")}
              >
                {bulkBusy === "local" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Laptop className="size-3.5" />
                )}
                Keep this device for all
              </Button>
              <Button
                size="sm"
                disabled={bulkBusy !== null}
                onClick={() => void resolveAll("cloud")}
              >
                {bulkBusy === "cloud" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Cloud className="size-3.5" />
                )}
                Keep cloud for all
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          showSkeleton ? (
            <ConflictsSkeleton />
          ) : (
            <div className="mt-8 h-40" aria-busy="true" />
          )
        ) : error ? (
          <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-6">
            <p className="text-[13px] font-medium text-destructive">
              Could not load sync conflicts
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">{error}</p>
            <Button className="mt-4" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : conflicts.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon={Check}
              title="No sync conflicts"
              description="Everything has converged across this device and the cloud."
            />
          </div>
        ) : (
          <div className="mt-7 space-y-4 animate-fade">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                lookup={lookupFor(conflict)}
                busy={busy}
                onResolve={resolve}
              />
            ))}
          </div>
        )}
      </div>
    </PageSurface>
  );
}

function ConflictsSkeleton() {
  return (
    <div
      className="mt-7 space-y-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading sync conflicts</span>
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index} className="overflow-hidden border-border/75">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="h-2.5 w-32" />
              </div>
              <Skeleton className="mt-2.5 h-4 w-2/5" />
              <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
            </div>
            <Skeleton className="size-4 rounded" />
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <Skeleton className="h-2.5 w-24" />
            <div className="overflow-hidden rounded-lg border border-border/60">
              {Array.from({ length: 3 }).map((_, row) => (
                <div
                  key={row}
                  className="grid grid-cols-[minmax(80px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border/40 px-3 py-2 last:border-b-0"
                >
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid border-t border-border/60 bg-background/35 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, side) => (
              <div
                key={side}
                className="flex flex-col gap-3 border-b border-border/60 p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-32" />
                <Skeleton className="h-8 w-36 rounded-lg" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ConflictCard({
  conflict,
  lookup,
  busy,
  onResolve,
}: {
  conflict: SyncConflictView;
  lookup: ConflictLookup;
  busy: string | null;
  onResolve: (conflict: SyncConflictView, choice: Choice) => void;
}) {
  const context = [conflict.projectName, conflict.boardName]
    .filter(Boolean)
    .join(" / ");
  const diff = buildConflictDiff(conflict, lookup);
  const cloudBusy = busy === `${conflict.id}:cloud`;
  const localBusy = busy === `${conflict.id}:local`;
  const anyBusy = cloudBusy || localBusy;

  return (
    <Card className="overflow-hidden border-border/75">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-warning uppercase">
              {TYPE_LABEL[conflict.entityType]}
            </span>
            {context && (
              <span className="truncate text-[11px] text-muted-foreground">
                {context}
              </span>
            )}
          </div>
          <h2 className="mt-1.5 truncate text-[15px] font-semibold">
            {conflict.entityLabel ?? "Untitled item"}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Detected {formatDateTime(conflict.createdAt)} · {diff.summary}
          </p>
        </div>
        <AlertTriangle className="size-4 shrink-0 text-warning" />
      </div>

      <div className="p-4 sm:p-5">
        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          What changed
        </h3>
        {diff.whiteboard && <WhiteboardDiffView stats={diff.whiteboard} />}
        {diff.note && <NoteDiffView stats={diff.note} />}
        {diff.changed.length > 0 && <ConflictDiffTable rows={diff.changed} />}
        {!diff.whiteboard && !diff.note && diff.changed.length === 0 && (
          <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
            No field-level difference is available. The item was changed on
            both devices, but the stored fields match.
          </p>
        )}
        {diff.unchanged.length > 0 && (
          <details className="group mt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
              Show {diff.unchanged.length} unchanged field
              {diff.unchanged.length === 1 ? "" : "s"}
            </summary>
            <ConflictDiffTable rows={diff.unchanged} muted />
          </details>
        )}
      </div>

      <div className="grid border-t border-border/60 bg-background/35 sm:grid-cols-2">
        <ResolutionAction
          icon={Laptop}
          label="This device"
          timestamp={conflict.incomingUpdatedAt}
          busy={localBusy}
          disabled={anyBusy}
          onClick={() => onResolve(conflict, "local")}
          buttonLabel="Keep this device’s version"
          variant="outline"
        />
        <ResolutionAction
          icon={Cloud}
          label="Cloud"
          timestamp={conflict.winningUpdatedAt}
          busy={cloudBusy}
          disabled={anyBusy}
          onClick={() => onResolve(conflict, "cloud")}
          buttonLabel="Keep cloud version"
        />
      </div>
    </Card>
  );
}

function ConflictDiffTable({
  rows,
  muted = false,
}: {
  rows: ConflictDiffRow[];
  muted?: boolean;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/60">
      <div className="grid grid-cols-[minmax(96px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border/60 bg-muted/35 px-3 py-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <span>Data</span>
        <span>This device</span>
        <span>Cloud</span>
      </div>
      {rows.map((row) => (
        <DiffRow key={row.key} row={row} muted={muted} />
      ))}
    </div>
  );
}

function DiffRow({ row, muted }: { row: ConflictDiffRow; muted: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const longText = Boolean(row.longText);
  return (
    <>
      <div
        className={
          muted
            ? "grid grid-cols-[minmax(96px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border/40 px-3 py-2 text-[11.5px]"
            : "grid grid-cols-[minmax(96px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border/40 bg-warning/5 px-3 py-2 text-[11.5px]"
        }
      >
        <span className="font-medium text-muted-foreground">{row.label}</span>
        <div className="min-w-0">
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-foreground/85">
            {row.local}
          </p>
          {longText && row.local !== row.cloud && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
            >
              <ChevronDown
                className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              {expanded ? "Hide line diff" : "View line diff"}
            </button>
          )}
        </div>
        <div className="min-w-0">
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-foreground/85">
            {row.cloud}
          </p>
        </div>
      </div>
      {expanded && row.longText && (
        <div className="border-b border-border/40 px-3 pb-2">
          <TextDiffView cloud={row.longText.cloud} local={row.longText.local} />
        </div>
      )}
    </>
  );
}

function TextDiffView({ cloud, local }: { cloud: string; local: string }) {
  const lines = diffText(cloud, local);
  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
      <p className="mb-1 font-sans text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Cloud → This device
      </p>
      {lines.map((line, index) => (
        <div
          key={index}
          className={
            line.kind === "added"
              ? "whitespace-pre-wrap break-words bg-success/10 text-success"
              : line.kind === "removed"
                ? "whitespace-pre-wrap break-words bg-destructive/10 text-destructive line-through"
                : "whitespace-pre-wrap break-words text-muted-foreground"
          }
        >
          {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}

function WhiteboardDiffView({
  stats,
}: {
  stats: NonNullable<ReturnType<typeof buildConflictDiff>["whiteboard"]>;
}) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Cloud elements
        </p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums">
          {stats.cloudElements}
        </p>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          This device
        </p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums">
          {stats.localElements}
        </p>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Changes
        </p>
        <p className="mt-1 text-[12px] text-foreground/85">
          {stats.added} added · {stats.removed} removed · {stats.modified} modified
        </p>
      </div>
    </div>
  );
}

function NoteDiffView({
  stats,
}: {
  stats: NonNullable<ReturnType<typeof buildConflictDiff>["note"]>;
}) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Cloud blocks
        </p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums">
          {stats.cloudBlocks}
        </p>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          This device
        </p>
        <p className="mt-1 text-[18px] font-semibold tabular-nums">
          {stats.localBlocks}
        </p>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Changes
        </p>
        <p className="mt-1 text-[12px] text-foreground/85">
          {stats.added} added · {stats.removed} removed · {stats.modified} modified
        </p>
      </div>
    </div>
  );
}

function ResolutionAction({
  icon: Icon,
  label,
  timestamp,
  busy,
  disabled,
  onClick,
  buttonLabel,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  timestamp: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  buttonLabel: string;
  variant?: "default" | "outline";
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        {formatDateTime(timestamp)}
      </p>
      <Button
        variant={variant}
        size="sm"
        className="mt-auto w-fit"
        onClick={onClick}
        disabled={disabled}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
        {buttonLabel}
      </Button>
    </div>
  );
}
