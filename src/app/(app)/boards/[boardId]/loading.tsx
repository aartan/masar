import { Skeleton } from "@/components/ui/skeleton";

export default function BoardLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-4 pt-5 pb-4 sm:px-6">
        <Skeleton className="h-2.5 w-32" />
        <div className="mt-4 flex items-start gap-3">
          <Skeleton className="mt-1 size-2.5 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="mt-2 h-3 w-80 max-w-full" />
            <Skeleton className="mt-3 h-2.5 w-48" />
          </div>
          <Skeleton className="hidden h-8 w-44 sm:block" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="mt-5 flex gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="ml-auto h-8 w-20" />
        </div>
      </div>

      <div className="flex gap-3 overflow-hidden px-4 py-4 sm:px-6">
        {Array.from({ length: 4 }).map((_, columnIndex) => (
          <div
            key={columnIndex}
            className="w-[288px] shrink-0 rounded-2xl border border-border/60 bg-muted/30 p-3"
          >
            <div className="flex items-center gap-2 px-1 pb-3">
              <Skeleton className="size-1.5 rounded-full" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="ml-auto size-5 rounded-md" />
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 3 - (columnIndex % 2) }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/60 bg-card p-3"
                >
                  <Skeleton className="h-2 w-14" />
                  <Skeleton className="mt-2.5 h-3.5 w-full" />
                  <Skeleton className="mt-1.5 h-3.5 w-3/5" />
                  <div className="mt-4 flex items-center gap-2">
                    <Skeleton className="h-2 w-10" />
                    <Skeleton className="h-2 w-14" />
                    <Skeleton className="ml-auto size-5 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
