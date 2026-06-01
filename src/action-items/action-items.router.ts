import { Router, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "../thoughts/capture.router";
import {
  createActionItemsService,
  ActionItemNotFoundError,
} from "./action-items.service";
import {
  listActionItemsQuerySchema,
  updateActionItemSchema,
} from "./action-items.validator";

export const createActionItemsRouter = (db: Pool): Router => {
  const router = Router();
  const service = createActionItemsService(db);

  router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = listActionItemsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid query" });
      }

      const result = await service.listActionItems(userId, parsed.data);
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.put("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = updateActionItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
      }

      const item = await service.updateActionItem(userId, req.params.id as string, parsed.data);
      return res.status(200).json(item);
    } catch (err) {
      if (err instanceof ActionItemNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      return next(err);
    }
  });

  router.post(
    "/:id/complete",
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const item = await service.completeActionItem(userId, req.params.id as string);
        return res.status(200).json(item);
      } catch (err) {
        if (err instanceof ActionItemNotFoundError) {
          return res.status(404).json({ error: err.message });
        }
        return next(err);
      }
    }
  );

  router.post(
    "/:id/uncomplete",
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const item = await service.uncompleteActionItem(userId, req.params.id as string);
        return res.status(200).json(item);
      } catch (err) {
        if (err instanceof ActionItemNotFoundError) {
          return res.status(404).json({ error: err.message });
        }
        return next(err);
      }
    }
  );

  router.delete("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      await service.deleteActionItem(userId, req.params.id as string);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof ActionItemNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      return next(err);
    }
  });

  return router;
};
