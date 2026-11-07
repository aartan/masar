import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { FolderKanban } from "lucide-react";

import { ProjectView } from "@/components/project/project-view";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { ProjectDetail } from "@/lib/types";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { refresh: refreshWorkspace } = useWorkspace();
  const [data, setData] = React.useState<ProjectDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api<{ project: ProjectDetail }>(`/api/projects/${projectId}`)
      .then((result) => {
        if (active) setData(result.project);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Could not load the project.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, attempt]);

  const reload = React.useCallback(() => {
    setAttempt((value) => value + 1);
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useOnSyncComplete(() => {
    void api<{ project: ProjectDetail }>(`/api/projects/${projectId}`)
      .then((result) => {
        setData(result.project);
        setError(null);
      })
      .catch(() => {
        /* Keep the current view if a background refresh fails. */
      });
  });

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-canvas">
        <div className="mx-auto w-full max-w-[1220px] px-5 py-8">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-56" />
          <Skeleton className="mt-2 h-3 w-72" />
          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FolderKanban className="size-5" />
          </span>
          <h1 className="font-display mt-4 text-xl font-semibold">
            Project could not be loaded
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error ?? "This project may have been deleted."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
            <Button asChild variant="outline">
              <Link to="/">Back to overview</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProjectView
      key={`${projectId}:${attempt}`}
      initialData={data}
      onChanged={reload}
    />
  );
}
