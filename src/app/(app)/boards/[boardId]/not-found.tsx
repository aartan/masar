import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function BoardNotFound() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Compass className="size-5" strokeWidth={1.6} />
        </span>
        <h1 className="font-display mt-5 text-xl font-semibold">
          This board is not here
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          It may have been deleted, or the link may be incorrect. Your other
          boards are waiting in the sidebar.
        </p>
        <Button asChild className="mt-5">
          <Link href="/">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
