import { Skeleton } from "@/components/ui/skeleton";

export default function OverviewLoading() {
  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto w-full max-w-[1220px] px-5 py-8 sm:px-8 lg:py-10">
        <Skeleton className="h-2.5 w-36" />
        <Skeleton className="mt-3 h-8 w-52" />
        <Skeleton className="mt-2.5 h-3.5 w-80 max-w-full" />
        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-border/70 bg-card px-5 pt-5 pb-4"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-12" />
              <Skeleton className="mt-3 h-2.5 w-32" />
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Skeleton className="h-[330px] rounded-xl" />
          <Skeleton className="h-[330px] rounded-xl" />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-[240px] rounded-xl" />
          <Skeleton className="h-[240px] rounded-xl" />
        </div>
      </div>
    </div>
  );
}
