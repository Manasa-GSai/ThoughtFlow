import { createCategorySchema, updateCategorySchema } from "../categories.validator";

describe("categories.validator", () => {
  it("accepts valid create payload", () => {
    const result = createCategorySchema.safeParse({
      name: "Side Project",
      color: "#ec4899",
      sortOrder: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid hex color on create", () => {
    const result = createCategorySchema.safeParse({
      name: "Side Project",
      color: "blue",
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one field on update", () => {
    const result = updateCategorySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
