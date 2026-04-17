"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PriorityBars } from "@/components/shared/task-meta";
import { PRIORITIES, PRIORITY_META, type Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function PrioritySelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Priority)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-8 text-[12.5px]", className)}>
        <span className="flex items-center gap-2">
          <PriorityBars priority={value} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority}>
            <span className="flex items-center gap-2">
              <PriorityBars priority={priority} />
              {PRIORITY_META[priority].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
