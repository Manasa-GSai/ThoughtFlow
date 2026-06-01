import express from "express";
import request from "supertest";
import { createCaptureRouter } from "../capture.router";
import { createMockStorageClient } from "../../storage/mock";
import path from "path";
import fs from "fs";

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const createApp = () => {
  const app = express();
  app.use(express.json());

  // Fake auth middleware injecting user
  app.use((req: any, _res, next) => {
    req.user = { id: "test-user-id", tier: "pro" };
    next();
  });

  const storage = createMockStorageClient();
  app.use("/api/thoughts", createCaptureRouter(mockPool, storage));
  return { app, storage };
};

describe("POST /api/thoughts/capture", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("text capture", () => {
    it("returns 201 with thought record for valid text", async () => {
      const fakeRow = {
        id: "thought-1",
        status: "transcribed",
        transcription_source: "typed",
        created_at: new Date().toISOString(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const { app } = createApp();
      const res = await request(app)
        .post("/api/thoughts/capture")
        .send({ text: "Buy milk tomorrow" })
        .expect(201);

      expect(res.body.id).toBe("thought-1");
      expect(res.body.transcription_source).toBe("typed");
      expect(res.body.status).toBe("transcribed");
    });

    it("returns 400 for empty text", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/thoughts/capture")
        .send({ text: "" })
        .expect(400);

      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].field).toBe("text");
    });

    it("returns 400 for missing text field with no audio", async () => {
      const { app } = createApp();
      await request(app)
        .post("/api/thoughts/capture")
        .send({})
        .expect(400);
    });
  });

  describe("voice capture", () => {
    it("returns 201 for valid audio upload", async () => {
      const fakeRow = {
        id: "voice-1",
        status: "pending",
        transcription_source: "voice",
        created_at: new Date().toISOString(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

      const { app } = createApp();
      const fixturePath = path.join(__dirname, "../../../test/fixtures/sample.wav");

      const res = await request(app)
        .post("/api/thoughts/capture")
        .attach("audio", fixturePath, { contentType: "audio/wav" })
        .expect(201);

      expect(res.body.id).toBe("voice-1");
      expect(res.body.transcription_source).toBe("voice");
      expect(res.body.status).toBe("pending");
    });

    it("returns 400 for non-audio MIME type", async () => {
      const { app } = createApp();
      const fixturePath = path.join(__dirname, "../../../test/fixtures/sample.wav");

      const res = await request(app)
        .post("/api/thoughts/capture")
        .attach("audio", fixturePath, { contentType: "application/pdf" })
        .expect(400);

      expect(res.body.error).toContain("Invalid audio format");
    });
  });

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      const app = express();
      app.use(express.json());
      const storage = createMockStorageClient();
      app.use("/api/thoughts", createCaptureRouter(mockPool, storage));

      const res = await request(app)
        .post("/api/thoughts/capture")
        .send({ text: "hello" })
        .expect(401);

      expect(res.body.error).toBe("Authentication required");
    });
  });
});
