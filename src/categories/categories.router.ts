import { Router, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "../thoughts/capture.router";
import {
  createCategoriesService,
  DuplicateCategoryError,
  MaxCategoriesError,
  CategoryNotFoundError,
} from "./categories.service";
import { createCategorySchema, updateCategorySchema } from "./categories.validator";

const requireProTier = (req: AuthenticatedRequest, res: Response): boolean => {
  if (req.user?.tier === "free") {
    res.status(403).json({
      error: "Custom categories are a Pro feature. Upgrade to Pro to create and manage your own categories.",
    });
    return false;
  }
  return true;
};

export const createCategoriesRouter = (db: Pool): Router => {
  const router = Router();
  const service = createCategoriesService(db);

  router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!requireProTier(req, res)) return;

      const categories = await service.listCategories(userId);
      return res.status(200).json({ categories });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!requireProTier(req, res)) return;

      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
      }

      const category = await service.createCategory(userId, parsed.data);
      return res.status(201).json(category);
    } catch (err) {
      if (err instanceof DuplicateCategoryError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof MaxCategoriesError) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  });

  router.put("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!requireProTier(req, res)) return;

      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
      }

      const category = await service.updateCategory(userId, req.params.id as string, parsed.data);
      return res.status(200).json(category);
    } catch (err) {
      if (err instanceof DuplicateCategoryError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof CategoryNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  });

  router.delete("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!requireProTier(req, res)) return;

      await service.deleteCategory(userId, req.params.id as string);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof CategoryNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  });

  return router;
};
