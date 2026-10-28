import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 text-center",
        compact ? "gap-2 px-4 py-7" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <div
        className={cn(
          "grid place-items-center rounded-full bg-accent text-accent-foreground",
          compact ? "size-8" : "size-11",
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} strokeWidth={1.7} />
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            "font-medium text-foreground",
            compact ? "text-[13px]" : "text-sm",
          )}
        >
          {title}
        </p>
        {description && (
          <p
            className={cn(
              "mx-auto max-w-sm leading-relaxed text-muted-foreground",
              compact ? "text-[11.5px]" : "text-[13px]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/80 bg-card px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_oklch(0.2_0.01_150/0.06)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function PageSectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}
