import { z } from "zod";

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "color must be a hex value like #6366f1");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: hexColorSchema,
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    color: hexColorSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((data) => data.name !== undefined || data.color !== undefined || data.sortOrder !== undefined, {
    message: "Provide at least one of name, color, or sortOrder",
  });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
