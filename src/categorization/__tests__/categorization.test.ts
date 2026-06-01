import { createCategorizationService } from "../categorization.service";
import { createCircuitBreaker } from "../../transcription/circuit-breaker";
import { ClaudeClient } from "../claude.client";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const createMockClaude = (): ClaudeClient & { categorizeFn: jest.Mock } => {
  const categorizeFn = jest.fn();
  return { categorize: categorizeFn, categorizeFn };
};

describe("CategorizationService", () => {
  let claude: ReturnType<typeof createMockClaude>;
  let circuitBreaker: ReturnType<typeof createCircuitBreaker>;

  beforeEach(() => {
    claude = createMockClaude();
    circuitBreaker = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    mockQuery.mockReset();
  });

  it("categorizes a thought and stores the result", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t1", raw_text: "Need to fix the bug in auth module", status: "transcribed" }] })
      .mockResolvedValueOnce({ rows: [] }) // custom categories
      .mockResolvedValueOnce({ rows: [] }); // update
    claude.categorizeFn.mockResolvedValueOnce({
      category: "work",
      confidence: 0.92,
      tags: ["bug", "auth", "coding"],
      sentiment: "neutral",
    });

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    const result = await service.categorizeThought("t1", "user-1");

    expect(result.status).toBe("categorized");
    expect(result.category).toBe("work");
    expect(result.confidence).toBe(0.92);
    expect(result.tags).toEqual(["bug", "auth", "coding"]);
  });

  it("includes custom categories in Claude call", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t2", raw_text: "Reading about clean architecture", status: "transcribed" }] })
      .mockResolvedValueOnce({ rows: [{ name: "reading" }, { name: "side-project" }] })
      .mockResolvedValueOnce({ rows: [] });
    claude.categorizeFn.mockResolvedValueOnce({
      category: "reading",
      confidence: 0.88,
      tags: ["architecture"],
      sentiment: "positive",
    });

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    await service.categorizeThought("t2", "user-2");

    expect(claude.categorizeFn).toHaveBeenCalledWith(
      "Reading about clean architecture",
      ["reading", "side-project"]
    );
  });

  it("returns queued when circuit breaker is open", async () => {
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure();

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    const result = await service.categorizeThought("t3", "user-1");

    expect(result.status).toBe("queued");
    expect(claude.categorizeFn).not.toHaveBeenCalled();
  });

  it("returns failed and records circuit breaker failure on Claude error", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t4", raw_text: "some text", status: "transcribed" }] })
      .mockResolvedValueOnce({ rows: [] });
    claude.categorizeFn.mockRejectedValueOnce(new Error("Claude API error"));

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    const result = await service.categorizeThought("t4", "user-1");

    expect(result.status).toBe("failed");
  });

  it("throws error when thought not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    await expect(service.categorizeThought("missing", "user-1")).rejects.toThrow("not found");
  });

  it("throws error when thought has no text", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "t5", raw_text: null, status: "pending" }] });

    const service = createCategorizationService(mockPool, claude, circuitBreaker);
    await expect(service.categorizeThought("t5", "user-1")).rejects.toThrow("no text");
  });
});

describe("Categorization Router - Tier Gating", () => {
  const express = require("express");
  const request = require("supertest");
  const { createCategorizationRouter } = require("../categorization.router");
  const { createCircuitBreaker } = require("../../transcription/circuit-breaker");

  it("returns 403 for Free tier users", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: "free-user", tier: "free" };
      next();
    });
    const cb = createCircuitBreaker();
    const mockClaude = { categorize: jest.fn() };
    app.use("/api/thoughts", createCategorizationRouter({ query: jest.fn() }, mockClaude, cb));

    const res = await request(app).post("/api/thoughts/t1/categorize").expect(403);
    expect(res.body.error).toContain("Pro feature");
  });

  it("allows Pro tier users", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: "pro-user", tier: "pro" };
      next();
    });
    const cb = createCircuitBreaker();
    const mockClaude = { categorize: jest.fn().mockResolvedValue({ category: "work", confidence: 0.9, tags: [], sentiment: "neutral" }) };
    const mockDb = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: "t1", raw_text: "test", status: "transcribed" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    app.use("/api/thoughts", createCategorizationRouter(mockDb, mockClaude, cb));

    const res = await request(app).post("/api/thoughts/t1/categorize").expect(200);
    expect(res.body.category).toBe("work");
  });
});
