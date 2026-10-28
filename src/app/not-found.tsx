import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Compass className="size-5" strokeWidth={1.6} />
        </span>
        <p className="mt-5 text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/60 uppercase">
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
          <Link href="/">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
