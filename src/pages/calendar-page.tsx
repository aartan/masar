import * as React from "react";
import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";

import { CalendarView } from "@/components/calendar/calendar-view";
import { PageSkeleton, PageSurface } from "@/components/layout/page-surface";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { useDelayedLoading } from "@/lib/use-delayed-loading";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { CalendarData } from "@/lib/types";

export function CalendarPage() {
  const [data, setData] = React.useState<CalendarData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);
  const showSkeleton = useDelayedLoading(loading);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api<{ calendar: CalendarData }>("/api/calendar")
      .then((result) => {
        if (active) setData(result.calendar);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load the calendar.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useOnSyncComplete(() => {
    void api<{ calendar: CalendarData }>("/api/calendar")
      .then((result) => {
        setData(result.calendar);
        setError(null);
      })
      .catch(() => {
        /* Keep the current calendar if a background refresh fails. */
      });
  });

  if (loading) {
    if (!showSkeleton) {
      return <div className="h-full" aria-busy="true" />;
    }
    return (
      <PageSkeleton label="Loading calendar">
        <CalendarSkeleton />
      </PageSkeleton>
    );
  }

  if (error || !data) {
    return (
      <PageSurface className="grid h-full place-items-center px-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays className="size-5" />
          </span>
          <h1 className="font-display mt-4 text-xl font-semibold">
            Calendar could not be loaded
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {error ?? "Your workspace could not be reached. Please try again."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Back to overview</Link>
            </Button>
          </div>
        </div>
      </PageSurface>
    );
  }

  return <CalendarView initialData={data} />;
}

function CalendarSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 bg-background/65">
        <div className="px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-h-4 items-center gap-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-2" />
            <Skeleton className="h-2.5 w-16" />
          </div>

          <div className="mt-2 flex min-h-[55px] flex-wrap items-start gap-x-3 gap-y-3">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-7 w-36" />
              <Skeleton className="mt-2 h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="ml-auto h-8 w-44 rounded-lg" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
            <div className="flex items-center gap-1">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="ml-1 h-7 w-14 rounded-lg" />
            </div>
            <div className="ml-auto hidden items-center gap-3 sm:flex">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-1">
                  <Skeleton className="size-1.5 rounded-full" />
                  <Skeleton className="h-2.5 w-12" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-6">
          <div className="grid min-h-[420px] flex-1 grid-cols-7 overflow-hidden rounded-xl border border-border/70 bg-card">
            {Array.from({ length: 35 }).map((_, index) => (
              <div
                key={index}
                className="border-r border-b border-border/55 p-1.5 last:border-r-0"
              >
                <Skeleton className="size-5 rounded-full" />
                {index % 4 === 0 && (
                  <Skeleton className="mt-1.5 h-3 w-full rounded" />
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="hidden shrink-0 border-l border-border/60 p-4 lg:block lg:w-[292px]">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-44" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="rounded-lg border border-border/65 bg-card p-2.5"
              >
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="mt-2 h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
