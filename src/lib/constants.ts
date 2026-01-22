export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<
  Priority,
  { label: string; rank: number; description: string }
> = {
  urgent: { label: "Urgent", rank: 0, description: "Needs attention now" },
  high: { label: "High", rank: 1, description: "Important this week" },
  medium: { label: "Medium", rank: 2, description: "Normal priority" },
  low: { label: "Low", rank: 3, description: "Nice to have" },
  none: { label: "No priority", rank: 4, description: "Unprioritized" },
};

export const BOARD_COLORS = [
  "sage",
  "sky",
  "amber",
  "rose",
  "violet",
  "slate",
] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

export const LABEL_COLORS = [
  "sage",
  "sky",
  "amber",
  "rose",
  "violet",
  "slate",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const DEFAULT_COLUMNS = [
  { name: "Backlog", isDone: false },
  { name: "To Do", isDone: false },
  { name: "In Progress", isDone: false },
  { name: "In Review", isDone: false },
  { name: "Done", isDone: true },
] as const;

export const TASK_SORTS = ["manual", "due", "priority", "newest"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const DUE_FILTERS = ["any", "overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export const SORT_LABELS: Record<TaskSort, string> = {
  manual: "Manual order",
  due: "Due date",
  priority: "Priority",
  newest: "Newest first",
};

export const DUE_FILTER_LABELS: Record<DueFilter, string> = {
  any: "Any due date",
  overdue: "Overdue",
  today: "Due today",
  week: "Next 7 days",
  none: "No due date",
};
