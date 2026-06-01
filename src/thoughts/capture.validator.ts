import { z } from "zod";

export const ALLOWED_AUDIO_MIMES = [
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
];

export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const textCaptureSchema = z.object({
  text: z
    .string()
    .min(1, "Text cannot be empty")
    .max(50000, "Text exceeds maximum length of 50,000 characters"),
});

export interface AudioValidationError {
  field: string;
  message: string;
}

export const validateAudioFile = (
  file: Express.Multer.File | undefined
): AudioValidationError | null => {
  if (!file) {
    return { field: "audio", message: "Audio file is required" };
  }

  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    return {
      field: "audio",
      message: `File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds maximum of 25MB`,
    };
  }

  if (!ALLOWED_AUDIO_MIMES.includes(file.mimetype)) {
    return {
      field: "audio",
      message: `Invalid audio format '${file.mimetype}'. Accepted: webm, wav, mp4, mpeg`,
    };
  }

  return null;
};
