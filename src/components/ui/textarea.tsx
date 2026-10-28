import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[76px] w-full resize-none rounded-lg border border-input bg-card/60 px-3 py-2 text-sm text-foreground shadow-[0_1px_0_oklch(1_0_0/0.35)_inset] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
