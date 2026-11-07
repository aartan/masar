import * as React from "react";
import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";

import { CalendarView } from "@/components/calendar/calendar-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { useOnSyncComplete } from "@/lib/use-sync-refresh";
import type { CalendarData } from "@/lib/types";

export function CalendarPage() {
  const [data, setData] = React.useState<CalendarData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);

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
    return (
      <div className="flex h-full flex-col bg-canvas">
        <div className="border-b border-border/60 bg-background/65 px-4 py-5 sm:px-6">
          <Skeleton className="h-3 w-28" />
          <div className="mt-3 flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div>
              <Skeleton className="h-7 w-40" />
              <Skeleton className="mt-2 h-3 w-52" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-4 p-4 sm:p-6">
          <Skeleton className="h-full min-h-[420px] flex-1 rounded-xl" />
          <Skeleton className="hidden h-full w-[292px] rounded-xl lg:block" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid h-full place-items-center px-6">
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
      </div>
    );
  }

  return <CalendarView initialData={data} />;
}
