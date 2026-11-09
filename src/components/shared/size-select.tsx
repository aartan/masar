"use client";

import { SizeBadge } from "@/components/shared/task-meta";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TASK_COMPLEXITIES,
  TASK_COMPLEXITY_META,
  type TaskComplexity,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

const NO_SIZE = "none";

export function SizeSelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: TaskComplexity | null;
  onChange: (size: TaskComplexity | null) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? NO_SIZE}
      onValueChange={(next) =>
        onChange(next === NO_SIZE ? null : (next as TaskComplexity))
      }
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-8 text-[12.5px]", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SIZE}>
          <span className="text-muted-foreground">No size</span>
        </SelectItem>
        {TASK_COMPLEXITIES.map((size) => {
          const meta = TASK_COMPLEXITY_META[size];
          return (
            <SelectItem key={size} value={size}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true">
                  <SizeBadge size={size} />
                </span>
                <span>{meta.label}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
