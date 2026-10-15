import { AlertTriangle, CalendarDays, CircleDashed } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Label, Task } from "@/lib/types";
import { formatDueDate, todayIso } from "@/lib/dates";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { LABEL_COLOR_CLASS } from "@/components/shared/colors";

const AVATAR_STYLES = [
  "bg-[oklch(0.9_0.045_150)] text-[oklch(0.35_0.06_152)] dark:bg-[oklch(0.3_0.04_152)] dark:text-[oklch(0.85_0.07_152)]",
  "bg-[oklch(0.91_0.04_235)] text-[oklch(0.38_0.08_235)] dark:bg-[oklch(0.3_0.04_235)] dark:text-[oklch(0.85_0.06_235)]",
  "bg-[oklch(0.92_0.05_80)] text-[oklch(0.4_0.08_75)] dark:bg-[oklch(0.32_0.05_80)] dark:text-[oklch(0.88_0.07_80)]",
  "bg-[oklch(0.92_0.035_295)] text-[oklch(0.4_0.09_295)] dark:bg-[oklch(0.31_0.045_295)] dark:text-[oklch(0.85_0.06_295)]",
  "bg-[oklch(0.92_0.035_20)] text-[oklch(0.42_0.1_22)] dark:bg-[oklch(0.31_0.04_22)] dark:text-[oklch(0.85_0.07_22)]",
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function AuthorAvatar({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  if (!name) return null;
  const style = AVATAR_STYLES[hashString(name) % AVATAR_STYLES.length];
  return (
    <Avatar
      className={cn("size-6 ring-2 ring-card", className)}
      title={name}
      aria-label={`Comment by ${name}`}
    >
      <AvatarFallback className={cn("text-[9px]", style)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function LabelChip({
  label,
  className,
  dot = true,
}: {
  label: Label;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        `${LABEL_COLOR_CLASS[label.color]} label-chip inline-flex h-[19px] max-w-[130px] items-center gap-1 truncate rounded-full px-1.5 text-[10px] font-medium`,
        className,
      )}
    >
      {dot && <span className="label-dot size-1.5 shrink-0 rounded-full" />}
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function PriorityBars({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  if (priority === "none") {
    return (
      <CircleDashed
        className={cn("size-3.5 text-muted-foreground/50", className)}
        aria-label={meta.label}
      />
    );
  }
  const filled = priority === "urgent" ? 3 : priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  const color =
    priority === "urgent"
      ? "bg-rose-500"
      : priority === "high"
        ? "bg-orange-500"
        : priority === "medium"
          ? "bg-amber-500"
          : "bg-sky-500";

  return (
    <span
      className={cn("flex h-3 items-end gap-[2px]", className)}
      title={`${meta.label} priority`}
      aria-label={`${meta.label} priority`}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "w-[3px] rounded-[1px]",
            index < filled ? color : "bg-muted-foreground/20",
          )}
          style={{ height: `${5 + index * 3.5}px` }}
        />
      ))}
    </span>
  );
}

export function DueDateChip({
  task,
  columnDone,
  className,
  showIcon = true,
}: {
  task: Pick<Task, "dueDate">;
  columnDone?: boolean;
  className?: string;
  showIcon?: boolean;
}) {
  const formatted = formatDueDate(task.dueDate);
  if (!formatted || !task.dueDate) return null;
  const overdue = !columnDone && task.dueDate < todayIso();
  const today = task.dueDate === todayIso();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
        overdue
          ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
          : today
            ? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        className,
      )}
      title={`Due ${task.dueDate}${overdue ? " — overdue" : ""}`}
    >
      {overdue ? (
        <AlertTriangle className="size-3" />
      ) : showIcon ? (
        <CalendarDays className="size-3 opacity-70" />
      ) : null}
      {formatted}
    </span>
  );
}

export function TaskMeta({
  task,
  columnDone,
  labelMap,
  maxLabels = 3,
}: {
  task: Task;
  columnDone?: boolean;
  labelMap: Map<string, Label>;
  maxLabels?: number;
}) {
  const labels = task.labelIds
    .map((id) => labelMap.get(id))
    .filter((label): label is Label => Boolean(label))
    .slice(0, maxLabels);
  const extra = task.labelIds.length - labels.length;

  return (
    <>
      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {extra > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              +{extra}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-muted-foreground">
        <PriorityBars priority={task.priority} />
        <DueDateChip task={task} columnDone={columnDone} />
      </div>
    </>
  );
}
