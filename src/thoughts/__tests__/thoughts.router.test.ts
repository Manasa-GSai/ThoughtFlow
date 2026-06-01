import express from "express";
import request from "supertest";
import { createThoughtsRouter } from "../thoughts.router";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const createApp = (userOverride?: any) => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = userOverride || { id: "user-1", tier: "pro" };
    next();
  });
  app.use("/api/thoughts", createThoughtsRouter(mockPool));
  return app;
};

describe("GET /api/thoughts", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns paginated thoughts with cursor", async () => {
    const thoughts = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      raw_text: `thought ${i}`,
      category: "work",
      status: "categorized",
      created_at: new Date(2026, 5, 1 - i),
    }));
    mockQuery.mockResolvedValueOnce({ rows: thoughts });

    const app = createApp();
    const res = await request(app).get("/api/thoughts?limit=20").expect(200);

    expect(res.body.thoughts).toHaveLength(3);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it("supports category filtering", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).get("/api/thoughts?category=work").expect(200);

    expect(mockQuery.mock.calls[0][0]).toContain("category = $");
    expect(mockQuery.mock.calls[0][1]).toContain("work");
  });

  it("excludes deleted thoughts by default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).get("/api/thoughts").expect(200);

    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at IS NULL");
  });

  it("includes deleted thoughts when include_deleted=true", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).get("/api/thoughts?include_deleted=true").expect(200);

    expect(mockQuery.mock.calls[0][0]).not.toContain("deleted_at IS NULL");
  });

  it("limits max results to 100", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).get("/api/thoughts?limit=500").expect(200);

    const queryParams = mockQuery.mock.calls[0][1];
    expect(queryParams[queryParams.length - 1]).toBe(101); // limit + 1
  });
});

describe("GET /api/thoughts/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns thought with action items", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t1", raw_text: "test", category: "work" }] })
      .mockResolvedValueOnce({ rows: [{ id: "a1", task: "Do thing", priority: "high" }] });

    const app = createApp();
    const res = await request(app).get("/api/thoughts/t1").expect(200);

    expect(res.body.id).toBe("t1");
    expect(res.body.action_items).toHaveLength(1);
  });

  it("returns 404 for non-existent thought", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).get("/api/thoughts/missing").expect(404);
  });
});

describe("PUT /api/thoughts/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  it("updates thought and creates audit log entry", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t1", raw_text: "old", category: "work" }] })
      .mockResolvedValueOnce({ rows: [{ id: "t1", raw_text: "new text", category: "work" }] })
      .mockResolvedValueOnce({ rows: [] }); // audit

    const app = createApp();
    const res = await request(app)
      .put("/api/thoughts/t1")
      .send({ raw_text: "new text" })
      .expect(200);

    expect(res.body.raw_text).toBe("new text");
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[2][0]).toContain("audit_log");
  });

  it("returns 400 when no fields provided", async () => {
    const app = createApp();
    await request(app).put("/api/thoughts/t1").send({}).expect(400);
  });
});

describe("DELETE /api/thoughts/:id", () => {
  beforeEach(() => mockQuery.mockReset());

  it("soft deletes thought and cascades to action items", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t1" }] })
      .mockResolvedValueOnce({ rows: [] }) // cascade
      .mockResolvedValueOnce({ rows: [] }); // audit

    const app = createApp();
    await request(app).delete("/api/thoughts/t1").expect(204);

    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at = NOW()");
    expect(mockQuery.mock.calls[1][0]).toContain("action_items");
  });

  it("returns 404 for non-existent thought", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    await request(app).delete("/api/thoughts/missing").expect(404);
  });
});

describe("User isolation", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns 401 when not authenticated", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/thoughts", createThoughtsRouter(mockPool));

    await request(app).get("/api/thoughts").expect(401);
  });
});
