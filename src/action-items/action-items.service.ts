import { Pool } from "pg";
import { ListActionItemsQuery, UpdateActionItemInput } from "./action-items.validator";

export interface ActionItemResponse {
  id: string;
  thoughtId: string;
  thoughtPreview: string | null;
  task: string;
  priority: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ActionItemNotFoundError extends Error {
  constructor() {
    super("Action item not found");
    this.name = "ActionItemNotFoundError";
  }
}

const PRIORITY_ORDER = `CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

const mapRow = (row: Record<string, unknown>): ActionItemResponse => ({
  id: row.id as string,
  thoughtId: row.thought_id as string,
  thoughtPreview: row.thought_preview as string | null,
  task: row.task as string,
  priority: row.priority as string,
  due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
  completed: row.completed as boolean,
  completed_at: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  created_at: (row.created_at as Date).toISOString(),
  updated_at: (row.updated_at as Date).toISOString(),
});

export interface ActionItemsService {
  listActionItems(userId: string, query: ListActionItemsQuery): Promise<{
    actionItems: ActionItemResponse[];
    nextCursor: string | null;
    hasMore: boolean;
  }>;
  updateActionItem(
    userId: string,
    actionItemId: string,
    input: UpdateActionItemInput
  ): Promise<ActionItemResponse>;
  completeActionItem(userId: string, actionItemId: string): Promise<ActionItemResponse>;
  uncompleteActionItem(userId: string, actionItemId: string): Promise<ActionItemResponse>;
  deleteActionItem(userId: string, actionItemId: string): Promise<void>;
}

export const createActionItemsService = (db: Pool): ActionItemsService => {
  const baseSelect = `
    SELECT ai.id, ai.thought_id, ai.task, ai.priority, ai.due_date, ai.completed,
           ai.completed_at, ai.created_at, ai.updated_at,
           LEFT(t.raw_text, 100) AS thought_preview
    FROM action_items ai
    LEFT JOIN thoughts t ON t.id = ai.thought_id
    WHERE ai.user_id = $1 AND ai.deleted_at IS NULL
  `;

  return {
    async listActionItems(userId, query) {
      const limit = query.limit ?? 20;
      const params: unknown[] = [userId];
      let sql = baseSelect;
      let paramIdx = 2;

      if (query.priority) {
        sql += ` AND ai.priority = $${paramIdx++}`;
        params.push(query.priority);
      }
      if (query.completed !== undefined) {
        sql += ` AND ai.completed = $${paramIdx++}`;
        params.push(query.completed);
      }
      if (query.due_before) {
        sql += ` AND ai.due_date <= $${paramIdx++}::date`;
        params.push(query.due_before);
      }
      if (query.due_after) {
        sql += ` AND ai.due_date >= $${paramIdx++}::date`;
        params.push(query.due_after);
      }
      if (query.overdue === true) {
        sql += ` AND ai.due_date < CURRENT_DATE AND ai.completed = false`;
      }

      if (query.cursor) {
        sql += ` AND (COALESCE(ai.due_date, '9999-12-31'::date), ai.id) > ($${paramIdx++}::date, $${paramIdx++}::uuid)`;
        const [cursorDue, cursorId] = query.cursor.split("|");
        params.push(cursorDue, cursorId);
      }

      sql += ` ORDER BY COALESCE(ai.due_date, '9999-12-31'::date) ASC, ${PRIORITY_ORDER}, ai.id ASC LIMIT $${paramIdx}`;
      params.push(limit + 1);

      const result = await db.query(sql, params);
      const hasMore = result.rows.length > limit;
      const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
      const last = rows[rows.length - 1];
      const nextCursor =
        hasMore && last
          ? `${last.due_date ? String(last.due_date).slice(0, 10) : "9999-12-31"}|${last.id}`
          : null;

      return {
        actionItems: rows.map(mapRow),
        nextCursor,
        hasMore,
      };
    },

    async updateActionItem(userId, actionItemId, input) {
      const current = await db.query(
        `SELECT id, task, priority, due_date, completed
         FROM action_items WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [actionItemId, userId]
      );

      if (!current.rows[0]) {
        throw new ActionItemNotFoundError();
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (input.task !== undefined) {
        updates.push(`task = $${idx++}`);
        params.push(input.task);
      }
      if (input.priority !== undefined) {
        updates.push(`priority = $${idx++}`);
        params.push(input.priority);
      }
      if (input.due_date !== undefined) {
        updates.push(`due_date = $${idx++}`);
        params.push(input.due_date);
      }
      updates.push(`updated_at = NOW()`);
      params.push(actionItemId, userId);

      await db.query(
        `UPDATE action_items SET ${updates.join(", ")}
         WHERE id = $${idx++} AND user_id = $${idx} AND deleted_at IS NULL`,
        params
      );

      await db.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, old_value, new_value, timestamp)
         VALUES ($1, 'action_item', $2, 'update', $3, $4, NOW())`,
        [
          userId,
          actionItemId,
          JSON.stringify(current.rows[0]),
          JSON.stringify({ ...current.rows[0], ...input }),
        ]
      );

      const refreshed = await db.query(
        `${baseSelect} AND ai.id = $2`,
        [userId, actionItemId]
      );

      return mapRow(refreshed.rows[0]);
    },

    async completeActionItem(userId, actionItemId) {
      const result = await db.query(
        `UPDATE action_items SET completed = true, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [actionItemId, userId]
      );

      if (!result.rows[0]) {
        throw new ActionItemNotFoundError();
      }

      const refreshed = await db.query(`${baseSelect} AND ai.id = $2`, [userId, actionItemId]);
      return mapRow(refreshed.rows[0]);
    },

    async uncompleteActionItem(userId, actionItemId) {
      const result = await db.query(
        `UPDATE action_items SET completed = false, completed_at = NULL, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [actionItemId, userId]
      );

      if (!result.rows[0]) {
        throw new ActionItemNotFoundError();
      }

      const refreshed = await db.query(`${baseSelect} AND ai.id = $2`, [userId, actionItemId]);
      return mapRow(refreshed.rows[0]);
    },

    async deleteActionItem(userId, actionItemId) {
      const result = await db.query(
        `UPDATE action_items SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [actionItemId, userId]
      );

      if (!result.rows[0]) {
        throw new ActionItemNotFoundError();
      }

      await db.query(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, timestamp)
         VALUES ($1, 'action_item', $2, 'delete', NOW())`,
        [userId, actionItemId]
      );
    },
  };
};
