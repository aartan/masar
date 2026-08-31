import Link from "next/link";

import { cn } from "@/lib/utils";

export function Logo({
  className,
  href = "/",
  compact = false,
}: {
  className?: string;
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="Masar home"
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      <span className="relative grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_1px_2px_oklch(0.2_0.01_150/0.2),inset_0_1px_0_oklch(1_0_0/0.18)] transition-transform group-hover:-rotate-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="4.5" height="16" rx="2.25" fill="currentColor" />
          <rect
            x="9.75"
            y="4"
            width="4.5"
            height="10.5"
            rx="2.25"
            fill="currentColor"
            opacity="0.72"
          />
          <rect
            x="16.5"
            y="4"
            width="4.5"
            height="13.5"
            rx="2.25"
            fill="currentColor"
            opacity="0.44"
          />
        </svg>
      </span>
      {!compact && (
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[17px] font-semibold text-foreground">
            masar
          </span>
          <span className="hidden text-[9px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase sm:inline">
            workspace
          </span>
        </span>
      )}
    </Link>
  );
}
