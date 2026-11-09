/**
 * The optional description shown under a space heading. Kanban spaces,
 * whiteboards and notes all use the same presentation so a description looks
 * identical wherever it appears. An empty description renders nothing, which
 * keeps spaces created before descriptions existed unchanged.
 */
export function SpaceDescription({
  description,
}: {
  description: string | null | undefined;
}) {
  if (!description) return null;
  return (
    <p className="mt-1 max-w-2xl truncate text-[12px] text-muted-foreground">
      {description}
    </p>
  );
}
