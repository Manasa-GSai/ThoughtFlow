import { createTranscriptionService } from "../transcription.service";
import { createCircuitBreaker } from "../circuit-breaker";
import { createMockStorageClient } from "../../storage/mock";
import { WhisperClient } from "../whisper.client";

const noopSleep = async () => {};

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const createMockWhisper = (): WhisperClient & { transcribeFn: jest.Mock } => {
  const transcribeFn = jest.fn();
  return {
    transcribe: transcribeFn,
    transcribeFn,
  };
};

describe("TranscriptionService", () => {
  let storage: ReturnType<typeof createMockStorageClient>;
  let whisper: ReturnType<typeof createMockWhisper>;
  let circuitBreaker: ReturnType<typeof createCircuitBreaker>;

  beforeEach(() => {
    storage = createMockStorageClient();
    whisper = createMockWhisper();
    circuitBreaker = createCircuitBreaker({ failureThreshold: 5, recoveryTimeMs: 30000 });
    mockQuery.mockReset();
  });

  it("transcribes audio and updates thought status", async () => {
    storage.upload("audio/thought-1.webm", Buffer.alloc(100), "audio/webm");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "thought-1", audio_storage_key: "audio/thought-1.webm" }] })
      .mockResolvedValueOnce({ rows: [] });
    whisper.transcribeFn.mockResolvedValueOnce({ text: "Buy milk tomorrow", language: "en" });

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    const result = await service.transcribeThought("thought-1");

    expect(result.status).toBe("transcribed");
    expect(result.text).toBe("Buy milk tomorrow");
    expect(whisper.transcribeFn).toHaveBeenCalledTimes(1);
  });

  it("deletes audio blob after successful transcription", async () => {
    storage.upload("audio/thought-2.webm", Buffer.alloc(50), "audio/webm");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "thought-2", audio_storage_key: "audio/thought-2.webm" }] })
      .mockResolvedValueOnce({ rows: [] });
    whisper.transcribeFn.mockResolvedValueOnce({ text: "test" });

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    await service.transcribeThought("thought-2");

    expect(await storage.exists("audio/thought-2.webm")).toBe(false);
  });

  it("retries on failure with exponential backoff", async () => {
    storage.upload("audio/t3.webm", Buffer.alloc(10), "audio/webm");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t3", audio_storage_key: "audio/t3.webm" }] })
      .mockResolvedValueOnce({ rows: [] });
    whisper.transcribeFn
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ text: "success after retry" });

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    const result = await service.transcribeThought("t3");

    expect(result.status).toBe("transcribed");
    expect(whisper.transcribeFn).toHaveBeenCalledTimes(3);
  });

  it("marks thought as failed after all retries exhausted", async () => {
    storage.upload("audio/t4.webm", Buffer.alloc(10), "audio/webm");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t4", audio_storage_key: "audio/t4.webm" }] })
      .mockResolvedValueOnce({ rows: [] });
    whisper.transcribeFn.mockRejectedValue(new Error("permanent failure"));

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    const result = await service.transcribeThought("t4");

    expect(result.status).toBe("failed");
    expect(whisper.transcribeFn).toHaveBeenCalledTimes(3);
  });

  it("queues thought when circuit breaker is open", async () => {
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure();
    expect(circuitBreaker.canExecute()).toBe(false);

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    const result = await service.transcribeThought("thought-5");

    expect(result.status).toBe("queued");
    expect(whisper.transcribeFn).not.toHaveBeenCalled();
  });

  it("records failure on circuit breaker after exhausting retries", async () => {
    storage.upload("audio/t6.webm", Buffer.alloc(10), "audio/webm");
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "t6", audio_storage_key: "audio/t6.webm" }] })
      .mockResolvedValueOnce({ rows: [] });
    whisper.transcribeFn.mockRejectedValue(new Error("fail"));

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    await service.transcribeThought("t6");

    // After 1 failure recorded, circuit should still be closed (need 5)
    expect(circuitBreaker.getState()).toBe("closed");
  });

  it("throws error if no audio key found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "x", audio_storage_key: null }] });

    const service = createTranscriptionService(mockPool, storage, whisper, circuitBreaker, { sleepFn: noopSleep });
    await expect(service.transcribeThought("x")).rejects.toThrow("No audio found");
  });
});
