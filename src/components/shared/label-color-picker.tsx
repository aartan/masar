"use client";

import * as React from "react";

import { LABEL_COLOR_SWATCH } from "@/components/shared/colors";
import { LABEL_COLORS, type LabelColor } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function LabelColorPicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: LabelColor;
  onChange: (color: LabelColor) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Label color"
      className={cn("flex items-center gap-1.5", className)}
    >
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`Color ${color}`}
          aria-pressed={value === color}
          disabled={disabled}
          className={cn(
            "grid size-5 place-items-center rounded-full border transition-colors disabled:opacity-50",
            value === color
              ? "border-foreground"
              : "border-transparent hover:border-border",
          )}
        >
          <span
            className={cn("size-2.5 rounded-full", LABEL_COLOR_SWATCH[color])}
          />
        </button>
      ))}
    </div>
  );
}
