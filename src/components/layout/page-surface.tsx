import * as React from "react";

import { cn } from "@/lib/utils";

interface PageSurfaceProps extends React.ComponentProps<"div"> {
  /** Use the page's own vertical scroll container with a stable gutter. */
  scroll?: boolean;
}

/**
 * The common surface for every route. Keeping the background on AppShell's
 * main element (instead of individual pages) prevents the large surface color
 * from jumping between routes, especially in dark mode.
 */
export function PageSurface({
  className,
  scroll = false,
  children,
  ...props
}: PageSurfaceProps) {
  return (
    <div
      className={cn(
        "h-full animate-page-enter",
        scroll && "scrollbar-thin scrollbar-stable overflow-y-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Accessible wrapper for a full-page loading skeleton. The skeleton itself is
 * hidden from assistive technology while the label is announced once.
 */
export function PageSkeleton({
  label,
  className,
  scroll = false,
  children,
}: {
  label: string;
  className?: string;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageSurface
      scroll={scroll}
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={scroll ? "min-h-full" : "h-full"}>
        {children}
      </div>
    </PageSurface>
  );
}
