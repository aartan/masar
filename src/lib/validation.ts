import { z } from "zod";

import {
  BOARD_COLORS,
  DUE_FILTERS,
  LABEL_COLORS,
  PRIORITIES,
  TASK_SORTS,
} from "@/lib/constants";

const idSchema = z.string().trim().min(1, "Invalid id").max(80);
const nameSchema = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter a valid email address."));

export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a valid date");

export const boardCreateSchema = z.object({
  name: nameSchema(80, "Board name"),
  description: z.string().trim().max(400).nullish(),
  color: z.enum(BOARD_COLORS).optional(),
});

export const boardUpdateSchema = z
  .object({
    name: nameSchema(80, "Board name").optional(),
    description: z.string().trim().max(400).nullable().optional(),
    color: z.enum(BOARD_COLORS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const columnCreateSchema = z.object({
  name: nameSchema(60, "Column name"),
  isDone: z.boolean().optional(),
});

export const columnUpdateSchema = z
  .object({
    name: nameSchema(60, "Column name").optional(),
    isDone: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const reorderColumnsSchema = z.object({
  columnIds: z.array(idSchema).min(1).max(50),
});

export const taskCreateSchema = z.object({
  columnId: idSchema,
  title: nameSchema(200, "Title"),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dateOnlySchema.nullish(),
  labelIds: z.array(idSchema).max(20).optional(),
});

export const taskUpdateSchema = z
  .object({
    title: nameSchema(200, "Title").optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    labelIds: z.array(idSchema).max(20).optional(),
    columnId: idSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const reorderTasksSchema = z.object({
  columns: z
    .array(
      z.object({
        columnId: idSchema,
        taskIds: z.array(idSchema).max(1000),
      }),
    )
    .min(1)
    .max(50),
});

export const subtaskCreateSchema = z.object({
  title: nameSchema(200, "Subtask"),
});

export const subtaskUpdateSchema = z
  .object({
    title: nameSchema(200, "Subtask").optional(),
    completed: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const commentCreateSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(2000, "Comment must be 2,000 characters or fewer"),
  author: z.string().trim().max(80).optional(),
});

export const labelCreateSchema = z.object({
  name: nameSchema(40, "Label name"),
  color: z.enum(LABEL_COLORS).optional(),
});

export const labelUpdateSchema = z
  .object({
    name: nameSchema(40, "Label name").optional(),
    color: z.enum(LABEL_COLORS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const taskQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  priority: z.enum(PRIORITIES).optional(),
  label: idSchema.optional(),
  due: z.enum(DUE_FILTERS).optional(),
  sort: z.enum(TASK_SORTS).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export type BoardCreateInput = z.infer<typeof boardCreateSchema>;
export type BoardUpdateInput = z.infer<typeof boardUpdateSchema>;
export type ColumnCreateInput = z.infer<typeof columnCreateSchema>;
export type ColumnUpdateInput = z.infer<typeof columnUpdateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
export type SubtaskUpdateInput = z.infer<typeof subtaskUpdateSchema>;
export type LabelCreateInput = z.infer<typeof labelCreateSchema>;
export type LabelUpdateInput = z.infer<typeof labelUpdateSchema>;
