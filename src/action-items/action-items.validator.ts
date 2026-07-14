import { z } from "zod";

const prioritySchema = z.enum(["high", "medium", "low"]);

export const listActionItemsQuerySchema = z.object({
  priority: prioritySchema.optional(),
  completed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export const updateActionItemSchema = z
  .object({
    task: z.string().trim().min(1).max(2000).optional(),
    priority: prioritySchema.optional(),
    due_date: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
      .optional(),
  })
  .refine((data) => data.task !== undefined || data.priority !== undefined || data.due_date !== undefined, {
    message: "Provide at least one of task, priority, or due_date",
  });

export type ListActionItemsQuery = {
  priority?: "high" | "medium" | "low";
  completed?: boolean;
  due_before?: string;
  due_after?: string;
  overdue?: boolean;
  limit?: number;
  cursor?: string;
};
export type UpdateActionItemInput = z.infer<typeof updateActionItemSchema>;
