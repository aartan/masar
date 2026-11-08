import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

import { PageSurface } from "@/components/layout/page-surface";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <PageSurface className="grid h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Compass className="size-5" strokeWidth={1.6} />
        </span>
        <p className="mt-5 text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          404
        </p>
        <h1 className="font-display mt-1 text-xl font-semibold">
          This path ends here
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          The page you are looking for does not exist. Head back to your
          workspace and pick up where you left off.
        </p>
        <Button asChild className="mt-5">
          <Link to="/">Back to overview</Link>
        </Button>
      </div>
    </PageSurface>
  );
}
