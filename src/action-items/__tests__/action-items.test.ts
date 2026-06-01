import {
  createActionItemsService,
  ActionItemNotFoundError,
} from "../action-items.service";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const sampleRow = {
  id: "a1",
  thought_id: "t1",
  task: "Review budget",
  priority: "high",
  due_date: new Date("2026-06-05"),
  completed: false,
  completed_at: null,
  created_at: new Date("2026-06-01"),
  updated_at: new Date("2026-06-01"),
  thought_preview: "Remember to review the Q3 budget proposal before Friday meeting",
};

describe("ActionItemsService", () => {
  let service: ReturnType<typeof createActionItemsService>;

  beforeEach(() => {
    mockQuery.mockReset();
    service = createActionItemsService(mockPool);
  });

  it("lists action items with overdue filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

    const result = await service.listActionItems("user-1", {
      overdue: true,
      completed: false,
      limit: 20,
    });

    expect(result.actionItems).toHaveLength(1);
    expect(result.actionItems[0].thoughtId).toBe("t1");
    expect(result.actionItems[0].thoughtPreview).toContain("Q3 budget");
    expect(mockQuery.mock.calls[0][0]).toContain("due_date < CURRENT_DATE");
    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at IS NULL");
  });

  it("lists items due before date for morning review", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

    await service.listActionItems("user-1", {
      due_before: "2026-06-10",
      completed: false,
      limit: 20,
    });

    expect(mockQuery.mock.calls[0][0]).toContain("due_date <=");
  });

  it("updates action item and writes audit log", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1", task: "Old", priority: "medium", due_date: null, completed: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...sampleRow, task: "Updated task" }] });

    const updated = await service.updateActionItem("user-1", "a1", {
      task: "Updated task",
      priority: "high",
    });

    expect(updated.task).toBe("Updated task");
    expect(mockQuery.mock.calls[2][0]).toContain("audit_log");
  });

  it("marks item complete with completed_at", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1" }] })
      .mockResolvedValueOnce({
        rows: [{ ...sampleRow, completed: true, completed_at: new Date("2026-06-02") }],
      });

    const result = await service.completeActionItem("user-1", "a1");

    expect(result.completed).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain("completed_at = NOW()");
  });

  it("reverses completion via uncomplete", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1" }] })
      .mockResolvedValueOnce({ rows: [{ ...sampleRow, completed: false, completed_at: null }] });

    const result = await service.uncompleteActionItem("user-1", "a1");

    expect(result.completed).toBe(false);
    expect(mockQuery.mock.calls[0][0]).toContain("completed_at = NULL");
  });

  it("soft-deletes action item", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a1" }] }).mockResolvedValueOnce({ rows: [] });

    await service.deleteActionItem("user-1", "a1");

    expect(mockQuery.mock.calls[0][0]).toContain("deleted_at = NOW()");
  });

  it("throws when action item not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(service.completeActionItem("user-1", "missing")).rejects.toThrow(
      ActionItemNotFoundError
    );
  });
});

describe("ActionItems Router", () => {
  const express = require("express");
  const request = require("supertest");
  const { createActionItemsRouter } = require("../action-items.router");

  const mountRouter = (userId = "user-1") => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: userId, tier: "pro" };
      next();
    });
    app.use("/api/action-items", createActionItemsRouter(mockPool));
    return app;
  };

  it("GET returns filtered action items", async () => {
    const app = mountRouter();
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

    const res = await request(app)
      .get("/api/action-items?overdue=true&completed=false")
      .expect(200);

    expect(res.body.actionItems[0].thoughtPreview).toBeDefined();
  });

  it("PUT updates and returns 200", async () => {
    const app = mountRouter();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1", task: "T", priority: "low", due_date: null, completed: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [sampleRow] });

    const res = await request(app)
      .put("/api/action-items/a1")
      .send({ priority: "high" })
      .expect(200);

    expect(res.body.priority).toBe("high");
  });

  it("POST complete and uncomplete", async () => {
    const app = mountRouter();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1" }] })
      .mockResolvedValueOnce({ rows: [{ ...sampleRow, completed: true, completed_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ id: "a1" }] })
      .mockResolvedValueOnce({ rows: [sampleRow] });

    await request(app).post("/api/action-items/a1/complete").expect(200);
    await request(app).post("/api/action-items/a1/uncomplete").expect(200);
  });

  it("DELETE returns 204", async () => {
    const app = mountRouter();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a1" }] }).mockResolvedValueOnce({ rows: [] });

    await request(app).delete("/api/action-items/a1").expect(204);
  });

  it("returns 404 for another user's item", async () => {
    const app = mountRouter("user-2");
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await request(app).post("/api/action-items/a1/complete").expect(404);
  });
});

describe("Action Items integration flow", () => {
  it("filters, completes, and deletes with audit trail", async () => {
    const service = createActionItemsService(mockPool);

    mockQuery.mockResolvedValueOnce({
      rows: [
        { ...sampleRow, id: "a1", due_date: new Date("2026-05-28") },
        { ...sampleRow, id: "a2", priority: "low", due_date: new Date("2026-06-10") },
      ],
    });

    const listed = await service.listActionItems("user-1", {
      overdue: true,
      completed: false,
      limit: 20,
    });
    expect(listed.actionItems.length).toBe(2);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "a1" }] })
      .mockResolvedValueOnce({
        rows: [{ ...sampleRow, id: "a1", completed: true, completed_at: new Date() }],
      });

    const completed = await service.completeActionItem("user-1", "a1");
    expect(completed.completed).toBe(true);

    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a1" }] }).mockResolvedValueOnce({ rows: [] });
    await service.deleteActionItem("user-1", "a1");
    expect(mockQuery.mock.calls[mockQuery.mock.calls.length - 2][0]).toContain("deleted_at");
  });
});
