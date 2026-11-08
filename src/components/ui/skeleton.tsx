import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "shimmer rounded-md bg-foreground/[0.06]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
