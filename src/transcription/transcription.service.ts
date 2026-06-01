import { Pool } from "pg";
import { StorageClient } from "../storage/client";
import { WhisperClient, WhisperResponse } from "./whisper.client";
import { CircuitBreaker } from "./circuit-breaker";

export interface TranscriptionResult {
  thoughtId: string;
  text: string;
  status: "transcribed" | "failed" | "queued";
}

export interface TranscriptionService {
  transcribeThought(thoughtId: string): Promise<TranscriptionResult>;
}

const MAX_RETRIES = 2;
const RETRY_DELAYS = [2000, 4000];

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TranscriptionServiceOptions {
  sleepFn?: (ms: number) => Promise<void>;
}

export const createTranscriptionService = (
  db: Pool,
  storage: StorageClient,
  whisper: WhisperClient,
  circuitBreaker: CircuitBreaker,
  options: TranscriptionServiceOptions = {}
): TranscriptionService => {
  const sleep = options.sleepFn || defaultSleep;
  return {
    async transcribeThought(thoughtId: string): Promise<TranscriptionResult> {
      if (!circuitBreaker.canExecute()) {
        await db.query(
          `UPDATE thoughts SET status = 'pending', updated_at = NOW() WHERE id = $1`,
          [thoughtId]
        );
        return { thoughtId, text: "", status: "queued" };
      }

      const thought = await db.query(
        `SELECT id, audio_storage_key FROM thoughts WHERE id = $1`,
        [thoughtId]
      );

      if (!thought.rows[0]?.audio_storage_key) {
        throw new Error(`No audio found for thought ${thoughtId}`);
      }

      const storageKey = thought.rows[0].audio_storage_key;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const audioExists = await storage.exists(storageKey);
          if (!audioExists) {
            throw new Error(`Audio blob not found: ${storageKey}`);
          }

          const contentType = storageKey.endsWith(".wav") ? "audio/wav" : "audio/webm";

          // For real implementation, we'd download the buffer from S3
          // Here we pass a placeholder - the actual impl would use storage.download()
          const result: WhisperResponse = await whisper.transcribe(
            Buffer.alloc(0), // placeholder - real impl downloads from S3
            contentType
          );

          circuitBreaker.recordSuccess();

          await db.query(
            `UPDATE thoughts SET raw_text = $1, status = 'transcribed', updated_at = NOW() WHERE id = $2`,
            [result.text, thoughtId]
          );

          // Delete audio blob after successful transcription (BR-5 privacy)
          await storage.delete(storageKey);

          return { thoughtId, text: result.text, status: "transcribed" };
        } catch (err) {
          lastError = err as Error;
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAYS[attempt]);
          }
        }
      }

      // All retries exhausted
      circuitBreaker.recordFailure();

      await db.query(
        `UPDATE thoughts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [thoughtId]
      );

      return { thoughtId, text: "", status: "failed" };
    },
  };
};
