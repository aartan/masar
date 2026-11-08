import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { FolderKanban } from "lucide-react";

import { PageSkeleton, PageSurface } from "@/components/layout/page-surface";
import { ProjectView } from "@/components/project/project-view";
import { useWorkspace } from "@/components/layout/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { ProjectDetail } from "@/lib/types";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { projects, refresh: refreshWorkspace } = useWorkspace();
  const projectSummary = projects.find((project) => project.id === projectId);
  const [data, setData] = React.useState<ProjectDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);
  const showSkeleton = useDelayedLoading(loading);

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
    if (!showSkeleton) {
      return <div className="h-full" aria-busy="true" />;
    }
    return (
      <PageSkeleton label="Loading project" scroll>
        <ProjectSkeleton boardCount={projectSummary?.boardCount ?? 3} />
      </PageSkeleton>
    );
  }

  if (error || !data) {
    return (
      <PageSurface className="grid h-full place-items-center px-6">
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
      </PageSurface>
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

function ProjectSkeleton({ boardCount }: { boardCount: number }) {
  return (
    <div className="mx-auto w-full max-w-[1220px] px-5 py-8">
      <header>
        <Skeleton className="h-3 w-20" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-8 w-56 max-w-full" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
        <Skeleton className="mt-3 h-3 w-80 max-w-full" />
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </header>

      <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: Math.max(1, boardCount) }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-border/70 bg-card p-4 shadow-soft"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 w-2/5" />
            </div>
            <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
            <Skeleton className="mt-2.5 h-2.5 w-3/5" />
          </div>
        ))}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-border/70 bg-card shadow-soft"
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
              <Skeleton className="size-4 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-48 max-w-full" />
              </div>
            </div>
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, row) => (
                <div key={row} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="h-2.5 w-2/5" />
                  </div>
                  <Skeleton className="h-2.5 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
