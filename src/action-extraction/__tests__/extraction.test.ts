import { createActionExtractionService, ActionExtractionClient } from "../extraction.service";
import { createCircuitBreaker } from "../../transcription/circuit-breaker";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const createMockClient = (): ActionExtractionClient & { extractFn: jest.Mock } => {
  const extractFn = jest.fn();
  return { extractActions: extractFn, extractFn };
};

describe("ActionExtractionService", () => {
  let client: ReturnType<typeof createMockClient>;
  let circuitBreaker: ReturnType<typeof createCircuitBreaker>;

  beforeEach(() => {
    client = createMockClient();
    circuitBreaker = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    mockQuery.mockReset();
  });

  it("extracts action items and stores them in database", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "t1", raw_text: "Send Q3 report to Sarah by Friday and pick up groceries tomorrow" }],
      })
      .mockResolvedValueOnce({ rows: [] }) // insert 1
      .mockResolvedValueOnce({ rows: [] }); // insert 2

    client.extractFn.mockResolvedValueOnce([
      { task: "Send Q3 report to Sarah", priority: "high", due_date: "2026-06-06" },
      { task: "Pick up groceries", priority: "medium", due_date: "2026-06-02" },
    ]);

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    const result = await service.extractAndStore("t1", "user-1");

    expect(result.status).toBe("extracted");
    expect(result.actionItems).toHaveLength(2);
    expect(result.actionItems[0].task).toBe("Send Q3 report to Sarah");
    expect(result.actionItems[1].due_date).toBe("2026-06-02");
    expect(mockQuery).toHaveBeenCalledTimes(3); // 1 select + 2 inserts
  });

  it("stores action items with thought_id FK for traceability", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t2", raw_text: "Call dentist" }] })
      .mockResolvedValueOnce({ rows: [] });

    client.extractFn.mockResolvedValueOnce([
      { task: "Call dentist", priority: "low", due_date: null },
    ]);

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    await service.extractAndStore("t2", "user-1");

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO action_items");
    expect(insertCall[1]).toContain("t2"); // thought_id
    expect(insertCall[1]).toContain("user-1"); // user_id
  });

  it("defaults priority to medium when undetermined", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t3", raw_text: "some text" }] })
      .mockResolvedValueOnce({ rows: [] });

    client.extractFn.mockResolvedValueOnce([
      { task: "Do something", priority: "invalid", due_date: null },
    ]);

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    const result = await service.extractAndStore("t3", "user-1");

    expect(result.actionItems[0].priority).toBe("medium");
  });

  it("returns empty array when no action items found", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "t4", raw_text: "The weather is nice today" }],
    });

    client.extractFn.mockResolvedValueOnce([]);

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    const result = await service.extractAndStore("t4", "user-1");

    expect(result.status).toBe("extracted");
    expect(result.actionItems).toHaveLength(0);
  });

  it("queues when circuit breaker is open", async () => {
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure();

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    const result = await service.extractAndStore("t5", "user-1");

    expect(result.status).toBe("queued");
    expect(client.extractFn).not.toHaveBeenCalled();
  });

  it("returns failed on Claude error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "t6", raw_text: "text" }] });
    client.extractFn.mockRejectedValueOnce(new Error("API down"));

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    const result = await service.extractAndStore("t6", "user-1");

    expect(result.status).toBe("failed");
  });

  it("throws when thought not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const service = createActionExtractionService(mockPool, client, circuitBreaker);
    await expect(service.extractAndStore("missing", "user-1")).rejects.toThrow("not found");
  });
});
