import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { Pool } from "pg";
import { AuthenticatedUser } from "../auth";
import { StorageClient } from "../storage/client";
import { createCaptureService } from "./capture.service";
import {
  validateAudioFile,
  textCaptureSchema,
  MAX_AUDIO_SIZE_BYTES,
} from "./capture.validator";

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_SIZE_BYTES },
});

export const createCaptureRouter = (db: Pool, storage: StorageClient): Router => {
  const router = Router();
  const captureService = createCaptureService(db, storage);

  router.post(
    "/capture",
    upload.single("audio"),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        // Voice capture (multipart with audio file)
        if (req.file) {
          const validationError = validateAudioFile(req.file);
          if (validationError) {
            const status = validationError.message.includes("exceeds maximum")
              ? 413
              : 400;
            return res
              .status(status)
              .json({ error: validationError.message, field: validationError.field });
          }

          const result = await captureService.captureVoice({
            userId,
            audioBuffer: req.file.buffer,
            contentType: req.file.mimetype,
            originalFilename: req.file.originalname,
          });

          return res.status(201).json(result);
        }

        // Text capture (JSON body)
        const parseResult = textCaptureSchema.safeParse(req.body);
        if (!parseResult.success) {
          const errors = parseResult.error.issues.map((e: any) => ({
            field: e.path.join(".") || "text",
            message: e.message,
          }));
          return res.status(400).json({ errors });
        }

        const result = await captureService.captureText({
          userId,
          text: parseResult.data.text,
        });

        return res.status(201).json(result);
      } catch (err) {
        return next(err);
      }
    }
  );

  return router;
};
