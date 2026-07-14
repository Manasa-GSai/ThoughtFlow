import {
  createCategoriesService,
  DuplicateCategoryError,
  MaxCategoriesError,
  CategoryNotFoundError,
} from "../categories.service";
import { buildDefaultCategoryList, MAX_CUSTOM_CATEGORIES } from "../categories.constants";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

describe("CategoriesService", () => {
  let service: ReturnType<typeof createCategoriesService>;

  beforeEach(() => {
    mockQuery.mockReset();
    service = createCategoriesService(mockPool);
  });

  it("lists default and custom categories", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "c1", name: "Side Project", color: "#ec4899", sort_order: 10 },
        { id: "c2", name: "Fitness", color: "#14b8a6", sort_order: 11 },
      ],
    });

    const categories = await service.listCategories("user-1");

    expect(categories.filter((c) => c.isDefault)).toHaveLength(buildDefaultCategoryList().length);
    expect(categories.filter((c) => !c.isDefault)).toHaveLength(2);
    expect(categories.find((c) => c.name === "Side Project")).toMatchObject({
      id: "c1",
      isDefault: false,
    });
  });

  it("creates a custom category", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "new-id", name: "Reading List", color: "#a855f7", sort_order: 5 }],
      });

    const created = await service.createCategory("user-1", {
      name: "Reading List",
      color: "#a855f7",
      sortOrder: 5,
    });

    expect(created).toEqual({
      id: "new-id",
      name: "Reading List",
      color: "#a855f7",
      sortOrder: 5,
      isDefault: false,
    });
  });

  it("rejects duplicate category names", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "existing" }] });

    await expect(
      service.createCategory("user-1", { name: "Fitness", color: "#14b8a6", sortOrder: 0 })
    ).rejects.toThrow(DuplicateCategoryError);
  });

  it("rejects when max custom categories reached", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: MAX_CUSTOM_CATEGORIES }] });

    await expect(
      service.createCategory("user-1", { name: "New", color: "#111111", sortOrder: 0 })
    ).rejects.toThrow(MaxCategoriesError);
  });

  it("updates name, color, and sort order", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "c1", name: "Fitness" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "c1", name: "Wellness", color: "#22c55e", sort_order: 3 }],
      });

    const updated = await service.updateCategory("user-1", "c1", {
      name: "Wellness",
      color: "#22c55e",
      sortOrder: 3,
    });

    expect(updated.name).toBe("Wellness");
    expect(updated.sortOrder).toBe(3);
  });

  it("soft-deletes a custom category", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "c1" }] });

    await expect(service.deleteCategory("user-1", "c1")).resolves.toBeUndefined();
    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at = NOW()");
  });

  it("throws when deleting a missing category", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(service.deleteCategory("user-1", "missing")).rejects.toThrow(
      CategoryNotFoundError
    );
  });

  it("returns active custom category names for categorization", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Side Project" }, { name: "Fitness" }],
    });

    const names = await service.getCustomCategoryNames("user-1");

    expect(names).toEqual(["Side Project", "Fitness"]);
    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at IS NULL");
  });
});

describe("Categories Router", () => {
  const express = require("express");
  const request = require("supertest");
  const { createCategoriesRouter } = require("../categories.router");

  const mountRouter = (tier: string) => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: "pro-user", tier };
      next();
    });
    app.use("/api/categories", createCategoriesRouter(mockPool));
    return app;
  };

  it("returns 403 for Free tier on all endpoints", async () => {
    const app = mountRouter("free");

    await request(app).get("/api/categories").expect(403);
    await request(app)
      .post("/api/categories")
      .send({ name: "Test", color: "#111111", sortOrder: 0 })
      .expect(403);
    await request(app)
      .put("/api/categories/cat-1")
      .send({ name: "Updated" })
      .expect(403);
    await request(app).delete("/api/categories/cat-1").expect(403);
  });

  it("POST creates category and returns 201", async () => {
    const app = mountRouter("pro");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "c1", name: "Side Project", color: "#ec4899", sort_order: 1 }],
      });

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "Side Project", color: "#ec4899", sortOrder: 1 })
      .expect(201);

    expect(res.body.name).toBe("Side Project");
  });

  it("POST returns 409 for duplicate names", async () => {
    const app = mountRouter("pro");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "existing" }] });

    const res = await request(app)
      .post("/api/categories")
      .send({ name: "Fitness", color: "#14b8a6", sortOrder: 0 })
      .expect(409);

    expect(res.body.error).toContain("Fitness");
  });

  it("GET returns default and custom categories", async () => {
    const app = mountRouter("pro");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "c1", name: "Fitness", color: "#14b8a6", sort_order: 1 }],
    });

    const res = await request(app).get("/api/categories").expect(200);

    expect(res.body.categories.length).toBeGreaterThan(buildDefaultCategoryList().length);
    expect(res.body.categories.some((c: any) => c.name === "work" && c.isDefault)).toBe(true);
    expect(res.body.categories.some((c: any) => c.name === "Fitness" && !c.isDefault)).toBe(
      true
    );
  });

  it("PUT updates category and returns 200", async () => {
    const app = mountRouter("pro");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "c1", name: "Fitness" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "c1", name: "Wellness", color: "#22c55e", sort_order: 2 }],
      });

    const res = await request(app)
      .put("/api/categories/c1")
      .send({ name: "Wellness", color: "#22c55e", sortOrder: 2 })
      .expect(200);

    expect(res.body.name).toBe("Wellness");
  });

  it("DELETE soft-deletes and returns 204", async () => {
    const app = mountRouter("pro");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "c1" }] });

    await request(app).delete("/api/categories/c1").expect(204);
  });
});

describe("Categories + Categorization integration", () => {
  const { createCategorizationService } = require("../../categorization/categorization.service");
  const { createCircuitBreaker } = require("../../transcription/circuit-breaker");

  it("includes newly created custom category in Claude schema", async () => {
    const categorizeFn = jest.fn().mockResolvedValue({
      category: "Side Project",
      confidence: 0.91,
      tags: ["startup"],
      sentiment: "positive",
    });
    const claude = { categorize: categorizeFn };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "cat-new", name: "Side Project", color: "#ec4899", sort_order: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "t1", raw_text: "Ship the MVP this week", status: "transcribed" }],
      })
      .mockResolvedValueOnce({ rows: [{ name: "Side Project" }] })
      .mockResolvedValueOnce({ rows: [] });

    const categoriesService = createCategoriesService(mockPool);
    await categoriesService.createCategory("user-pro", {
      name: "Side Project",
      color: "#ec4899",
      sortOrder: 1,
    });

    const circuitBreaker = createCircuitBreaker();
    const categorizationService = createCategorizationService(mockPool, claude, circuitBreaker);
    const result = await categorizationService.categorizeThought("t1", "user-pro");

    expect(result.category).toBe("Side Project");
    expect(categorizeFn).toHaveBeenCalledWith("Ship the MVP this week", ["Side Project"]);
  });
});
