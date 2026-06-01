import { Router, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AuthenticatedRequest } from "./capture.router";

export const createThoughtsRouter = (db: Pool): Router => {
  const router = Router();

  // GET /api/thoughts - paginated list with filtering
  router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const cursor = req.query.cursor as string | undefined;
      const category = req.query.category as string | undefined;
      const status = req.query.status as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const includeDeleted = req.query.include_deleted === "true";

      let query = `SELECT id, raw_text, transcription_source, category, ai_confidence_score, status, version, created_at, updated_at
                   FROM thoughts WHERE user_id = $1`;
      const params: any[] = [userId];
      let paramIdx = 2;

      if (!includeDeleted) {
        query += ` AND deleted_at IS NULL`;
      }
      if (category) {
        query += ` AND category = $${paramIdx++}`;
        params.push(category);
      }
      if (status) {
        query += ` AND status = $${paramIdx++}`;
        params.push(status);
      }
      if (dateFrom) {
        query += ` AND created_at >= $${paramIdx++}`;
        params.push(dateFrom);
      }
      if (dateTo) {
        query += ` AND created_at <= $${paramIdx++}`;
        params.push(dateTo);
      }
      if (cursor) {
        query += ` AND created_at < $${paramIdx++}`;
        params.push(cursor);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
      params.push(limit + 1);

      const result = await db.query(query, params);
      const hasMore = result.rows.length > limit;
      const thoughts = hasMore ? result.rows.slice(0, limit) : result.rows;
      const nextCursor = hasMore ? thoughts[thoughts.length - 1].created_at.toISOString() : null;

      return res.json({ thoughts, nextCursor, hasMore });
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/thoughts/:id - single thought with action items
  router.get("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const thought = await db.query(
        `SELECT id, raw_text, transcription_source, category, ai_confidence_score, status, version, created_at, updated_at
         FROM thoughts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [req.params.id, userId]
      );

      if (!thought.rows[0]) {
        return res.status(404).json({ error: "Thought not found" });
      }

      const actionItems = await db.query(
        `SELECT id, task, priority, due_date, completed, completed_at, created_at
         FROM action_items WHERE thought_id = $1 AND user_id = $2 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [req.params.id, userId]
      );

      return res.json({ ...thought.rows[0], action_items: actionItems.rows });
    } catch (err) {
      return next(err);
    }
  });

  // PUT /api/thoughts/:id - update thought
  router.put("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const { raw_text, category } = req.body;
      if (!raw_text && !category) {
        return res.status(400).json({ error: "Provide raw_text or category to update" });
      }

      // Get current state for audit
      const current = await db.query(
        `SELECT id, raw_text, category FROM thoughts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [req.params.id, userId]
      );

      if (!current.rows[0]) {
        return res.status(404).json({ error: "Thought not found" });
      }

      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (raw_text !== undefined) {
        updates.push(`raw_text = $${idx++}`);
        params.push(raw_text);
      }
      if (category !== undefined) {
        updates.push(`category = $${idx++}`);
        params.push(category);
      }
      updates.push(`updated_at = NOW()`);
      params.push(req.params.id, userId);

      const result = await db.query(
        `UPDATE thoughts SET ${updates.join(", ")} WHERE id = $${idx++} AND user_id = $${idx}
         RETURNING id, raw_text, category, status, version, updated_at`,
        params
      );

      // Audit log
      await db.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, old_value, new_value, timestamp)
         VALUES ($1, 'thought', $2, 'update', $3, $4, NOW())`,
        [userId, req.params.id, JSON.stringify(current.rows[0]), JSON.stringify(result.rows[0])]
      );

      return res.json(result.rows[0]);
    } catch (err) {
      return next(err);
    }
  });

  // DELETE /api/thoughts/:id - soft delete
  router.delete("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const result = await db.query(
        `UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [req.params.id, userId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: "Thought not found" });
      }

      // Cascade soft delete to action items
      await db.query(
        `UPDATE action_items SET deleted_at = NOW(), updated_at = NOW()
         WHERE thought_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [req.params.id, userId]
      );

      // Audit log
      await db.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, old_value, new_value, timestamp)
         VALUES ($1, 'thought', $2, 'delete', NULL, NULL, NOW())`,
        [userId, req.params.id]
      );

      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  });

  return router;
};
