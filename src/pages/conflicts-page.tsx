import * as React from "react";
import { AlertTriangle, Check, Cloud, Laptop, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/dates";
import type { SyncConflictView } from "@/lib/types";

type Choice = "cloud" | "local";

const TYPE_LABEL: Record<SyncConflictView["entityType"], string> = {
  project: "Project",
  board: "Board",
  column: "Column",
  task: "Task",
  label: "Label",
  task_label: "Task label",
  subtask: "Subtask",
  comment: "Comment",
  whiteboard: "Whiteboard",
};

export function ConflictsPage() {
  const { refresh } = useWorkspace();
  const bridge = window.masarDesktop;
  const [conflicts, setConflicts] = React.useState<SyncConflictView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ conflicts: SyncConflictView[] }>(
        "/api/sync/conflicts",
      );
      setConflicts(data.conflicts);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load conflicts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

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
      await Promise.all([load(), refresh()]);
    } catch (caught) {
      toast.error("Could not resolve conflict", {
        description: errorMessage(caught),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[1000px] px-5 py-8 sm:px-8">
        <header className="animate-rise">
          <p className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
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

        {loading ? (
          <div className="mt-8 grid place-items-center rounded-xl border border-border/70 bg-card py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
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
          <div className="mt-7 space-y-4">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                busy={busy}
                onResolve={resolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConflictCard({
  conflict,
  busy,
  onResolve,
}: {
  conflict: SyncConflictView;
  busy: string | null;
  onResolve: (conflict: SyncConflictView, choice: Choice) => void;
}) {
  const context = [conflict.projectName, conflict.boardName]
    .filter(Boolean)
    .join(" / ");
  const cloudBusy = busy === `${conflict.id}:cloud`;
  const localBusy = busy === `${conflict.id}:local`;
  const anyBusy = cloudBusy || localBusy;

  return (
    <Card className="overflow-hidden border-border/75">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
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
            Detected {formatDateTime(conflict.createdAt)}
          </p>
        </div>
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <ConflictVersion
          icon={Laptop}
          label="This device"
          deleted={conflict.incomingDeleted}
          data={conflict.incomingData}
          entityType={conflict.entityType}
          updatedAt={conflict.incomingUpdatedAt}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResolve(conflict, "local")}
              disabled={anyBusy}
            >
              {localBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Laptop className="size-3.5" />
              )}
              Keep this device’s version
            </Button>
          }
        />
        <ConflictVersion
          icon={Cloud}
          label="Cloud"
          deleted={conflict.winningDeleted}
          data={conflict.winningData}
          entityType={conflict.entityType}
          updatedAt={conflict.winningUpdatedAt}
          action={
            <Button
              size="sm"
              onClick={() => onResolve(conflict, "cloud")}
              disabled={anyBusy}
            >
              {cloudBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Cloud className="size-3.5" />
              )}
              Keep cloud version
            </Button>
          }
        />
      </div>
    </Card>
  );
}

function ConflictVersion({
  icon: Icon,
  label,
  data,
  entityType,
  deleted,
  updatedAt,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  data: Record<string, unknown>;
  entityType: SyncConflictView["entityType"];
  deleted: boolean;
  updatedAt: string;
  action: React.ReactNode;
}) {
  const details = describeVersion(entityType, data);
  return (
    <div className="flex min-h-44 flex-col rounded-xl border border-border/60 bg-background/45 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 text-[10.5px] text-muted-foreground/70">
        {formatDateTime(updatedAt)}
      </p>
      {deleted ? (
        <p className="mt-3 text-[12.5px] font-medium text-destructive">
          Deleted
        </p>
      ) : details.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          No preview available.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-foreground/85">
          {details.map((line, index) => (
            <li key={index} className={index === 0 ? "font-medium" : "text-muted-foreground"}>
              {line}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-4">{action}</div>
    </div>
  );
}

function describeVersion(
  entityType: SyncConflictView["entityType"],
  data: Record<string, unknown>,
): string[] {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const lines: string[] = [];

  if (entityType === "whiteboard") {
    const scene = text(data.scene);
    let elements = 0;
    if (scene) {
      try {
        const parsed = JSON.parse(scene) as { elements?: unknown };
        elements = Array.isArray(parsed.elements) ? parsed.elements.length : 0;
      } catch {
        /* show the size fallback below */
      }
    }
    lines.push(`Whiteboard canvas · ${elements} element${elements === 1 ? "" : "s"}`);
    return lines;
  }

  const title =
    text(data.name) ??
    text(data.title) ??
    text(data.body) ??
    text(data.label) ??
    null;
  if (title) lines.push(title);
  const description = text(data.description);
  if (description) lines.push(description);
  if (entityType === "task_label") {
    lines.push(`${text(data.task_id) ?? "Task"} / ${text(data.label_id) ?? "Label"}`);
  }
  return lines;
}
