import { Router, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "../thoughts/capture.router";
import { createCategorizationService } from "./categorization.service";
import { ClaudeClient } from "./claude.client";
import { CircuitBreaker } from "../transcription/circuit-breaker";

export const createCategorizationRouter = (
  db: Pool,
  claude: ClaudeClient,
  circuitBreaker: CircuitBreaker
): Router => {
  const router = Router();
  const service = createCategorizationService(db, claude, circuitBreaker);

  router.post(
    "/:id/categorize",
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        const userTier = req.user?.tier;

        if (!userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        if (userTier === "free") {
          return res.status(403).json({
            error: "AI categorization is a Pro feature. Upgrade to Pro for automatic thought organization.",
          });
        }

        const result = await service.categorizeThought(req.params.id as string, userId);
        return res.status(200).json(result);
      } catch (err: any) {
        if (err.message?.includes("not found")) {
          return res.status(404).json({ error: err.message });
        }
        return next(err);
      }
    }
  );

  return router;
};
