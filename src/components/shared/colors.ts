import type { BoardColor, LabelColor } from "@/lib/constants";

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

export const BOARD_COLOR_CLASS: Record<BoardColor, string> = {
  sage: "board-sage",
  sky: "board-sky",
  amber: "board-amber",
  rose: "board-rose",
  violet: "board-violet",
  slate: "board-slate",
};

export const LABEL_COLOR_SWATCH: Record<LabelColor, string> = {
  sage: "bg-[var(--label-sage-dot)]",
  sky: "bg-[var(--label-sky-dot)]",
  amber: "bg-[var(--label-amber-dot)]",
  rose: "bg-[var(--label-rose-dot)]",
  violet: "bg-[var(--label-violet-dot)]",
  slate: "bg-[var(--label-slate-dot)]",
};
