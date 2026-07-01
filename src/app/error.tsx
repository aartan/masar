"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <TriangleAlert className="size-5" strokeWidth={1.7} />
        </span>
        <h1 className="font-display mt-5 text-xl font-semibold">
          Something went sideways
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Kanso could not load this view. Your data is safe — try again, and if
          the problem continues check the database configuration.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[10.5px] text-muted-foreground/60">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button variant="outline" onClick={() => router.push("/")}>
            Go to overview
          </Button>
        </div>
      </div>
    </div>
  );
}
