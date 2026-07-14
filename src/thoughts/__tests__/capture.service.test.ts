import { createCaptureService } from "../capture.service";
import { createMockStorageClient } from "../../storage/mock";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

describe("CaptureService", () => {
  let storage: ReturnType<typeof createMockStorageClient>;
  let service: ReturnType<typeof createCaptureService>;

  beforeEach(() => {
    storage = createMockStorageClient();
    service = createCaptureService(mockPool, storage);
    mockQuery.mockReset();
  });

  describe("captureVoice", () => {
    it("uploads audio to storage and creates thought with pending status", async () => {
      const fakeRow = {
        id: "test-uuid",
        status: "pending",
        transcription_source: "voice",
        created_at: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const result = await service.captureVoice({
        userId: "user-1",
        audioBuffer: Buffer.alloc(512),
        contentType: "audio/webm",
      });

      expect(result).toEqual(fakeRow);
      expect(storage.getStore().size).toBe(1);

      const [storedKey] = [...storage.getStore().keys()];
      expect(storedKey).toMatch(/^audio\/.+\.webm$/);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO thoughts"),
        expect.arrayContaining(["user-1"])
      );
    });

    it("uses correct extension for wav files", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "id", status: "pending", transcription_source: "voice", created_at: new Date() }],
      });

      await service.captureVoice({
        userId: "user-1",
        audioBuffer: Buffer.alloc(100),
        contentType: "audio/wav",
      });

      const [storedKey] = [...storage.getStore().keys()];
      expect(storedKey).toMatch(/\.wav$/);
    });

    it("stores audio_storage_key in the database query", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "id", status: "pending", transcription_source: "voice", created_at: new Date() }],
      });

      await service.captureVoice({
        userId: "user-1",
        audioBuffer: Buffer.alloc(100),
        contentType: "audio/webm",
      });

      const queryArgs = mockQuery.mock.calls[0][1];
      expect(queryArgs[2]).toMatch(/^audio\/.+\.webm$/);
    });
  });

  describe("captureText", () => {
    it("creates thought with transcribed status and typed source", async () => {
      const fakeRow = {
        id: "text-uuid",
        status: "transcribed",
        transcription_source: "typed",
        created_at: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const result = await service.captureText({
        userId: "user-2",
        text: "Remember to call dentist",
      });

      expect(result).toEqual(fakeRow);
      expect(storage.getStore().size).toBe(0);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO thoughts"),
        expect.arrayContaining(["user-2", "Remember to call dentist"])
      );
    });

    it("does not upload anything to storage", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "id", status: "transcribed", transcription_source: "typed", created_at: new Date() }],
      });

      await service.captureText({ userId: "u1", text: "hello" });
      expect(storage.getStore().size).toBe(0);
    });
  });
});
