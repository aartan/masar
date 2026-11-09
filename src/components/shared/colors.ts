import type { LabelColor, TaskComplexity } from "@/lib/constants";

/**
 * Literal class names keep Tailwind's scanner aware of every color variant.
 */
export const LABEL_COLOR_CLASS: Record<LabelColor, string> = {
  sage: "label-sage",
  sky: "label-sky",
  amber: "label-amber",
  rose: "label-rose",
  violet: "label-violet",
  slate: "label-slate",
};

export const LABEL_COLOR_SWATCH: Record<LabelColor, string> = {
  sage: "bg-[var(--label-sage-dot)]",
  sky: "bg-[var(--label-sky-dot)]",
  amber: "bg-[var(--label-amber-dot)]",
  rose: "bg-[var(--label-rose-dot)]",
  violet: "bg-[var(--label-violet-dot)]",
  slate: "bg-[var(--label-slate-dot)]",
};

/** Badge styling for T-shirt-size estimates, ordered from light to strong. */
export const SIZE_BADGE_CLASS: Record<TaskComplexity, string> = {
  XS: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  S: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  M: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  L: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  XL: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** Solid bar colours used by the effort breakdown chart. */
export const SIZE_BAR_CLASS: Record<TaskComplexity, string> = {
  XS: "bg-sky-500",
  S: "bg-emerald-500",
  M: "bg-amber-500",
  L: "bg-orange-500",
  XL: "bg-rose-500",
};
