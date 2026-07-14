import { Pool } from "pg";
import { randomUUID } from "crypto";
import { StorageClient } from "../storage/client";

export interface CaptureVoiceInput {
  userId: string;
  audioBuffer: Buffer;
  contentType: string;
  originalFilename?: string;
}

export interface CaptureTextInput {
  userId: string;
  text: string;
}

export interface CaptureResult {
  id: string;
  status: string;
  transcription_source: string;
  created_at: Date;
}

export interface CaptureService {
  captureVoice(input: CaptureVoiceInput): Promise<CaptureResult>;
  captureText(input: CaptureTextInput): Promise<CaptureResult>;
}

export const createCaptureService = (
  db: Pool,
  storage: StorageClient
): CaptureService => {
  return {
    async captureVoice(input: CaptureVoiceInput): Promise<CaptureResult> {
      const thoughtId = randomUUID();
      const extension = mimeToExtension(input.contentType);
      const storageKey = `audio/${thoughtId}.${extension}`;

      await storage.upload(storageKey, input.audioBuffer, input.contentType);

      const result = await db.query(
        `INSERT INTO thoughts (id, user_id, raw_text, transcription_source, status, audio_storage_key, version, created_at, updated_at)
         VALUES ($1, $2, NULL, 'voice', 'pending', $3, 1, NOW(), NOW())
         RETURNING id, status, transcription_source, created_at`,
        [thoughtId, input.userId, storageKey]
      );

      return result.rows[0];
    },

    async captureText(input: CaptureTextInput): Promise<CaptureResult> {
      const thoughtId = randomUUID();

      const result = await db.query(
        `INSERT INTO thoughts (id, user_id, raw_text, transcription_source, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'typed', 'transcribed', 1, NOW(), NOW())
         RETURNING id, status, transcription_source, created_at`,
        [thoughtId, input.userId, input.text]
      );

      return result.rows[0];
    },
  };
};

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
  };
  return map[mimeType] || "webm";
}
