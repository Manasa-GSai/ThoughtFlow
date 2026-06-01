import { Pool } from "pg";
import { buildDefaultCategoryList, MAX_CUSTOM_CATEGORIES } from "./categories.constants";
import { CreateCategoryInput, UpdateCategoryInput } from "./categories.validator";

export interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isDefault: false;
}

export interface CategoryListItem {
  id: string | null;
  name: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
}

export class DuplicateCategoryError extends Error {
  constructor(name: string) {
    super(`Category "${name}" already exists`);
    this.name = "DuplicateCategoryError";
  }
}

export class MaxCategoriesError extends Error {
  constructor() {
    super(`Maximum of ${MAX_CUSTOM_CATEGORIES} custom categories allowed`);
    this.name = "MaxCategoriesError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Custom category not found");
    this.name = "CategoryNotFoundError";
  }
}

export interface CategoriesService {
  listCategories(userId: string): Promise<CategoryListItem[]>;
  createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryRecord>;
  updateCategory(userId: string, categoryId: string, input: UpdateCategoryInput): Promise<CategoryRecord>;
  deleteCategory(userId: string, categoryId: string): Promise<void>;
  getCustomCategoryNames(userId: string): Promise<string[]>;
}

export const createCategoriesService = (db: Pool): CategoriesService => {
  const countActiveCustom = async (userId: string): Promise<number> => {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count FROM custom_categories
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    return result.rows[0].count;
  };

  const findDuplicate = async (userId: string, name: string, excludeId?: string): Promise<boolean> => {
    const params: string[] = [userId, name.toLowerCase()];
    let sql = `SELECT id FROM custom_categories
               WHERE user_id = $1 AND LOWER(name) = $2 AND deleted_at IS NULL`;
    if (excludeId) {
      sql += ` AND id != $3`;
      params.push(excludeId);
    }
    const result = await db.query(sql, params);
    return result.rows.length > 0;
  };

  return {
    async listCategories(userId: string): Promise<CategoryListItem[]> {
      const custom = await db.query(
        `SELECT id, name, color, sort_order
         FROM custom_categories
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order ASC, name ASC`,
        [userId]
      );

      const customItems: CategoryListItem[] = custom.rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        sortOrder: row.sort_order,
        isDefault: false,
      }));

      return [...buildDefaultCategoryList(), ...customItems];
    },

    async createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryRecord> {
      const activeCount = await countActiveCustom(userId);
      if (activeCount >= MAX_CUSTOM_CATEGORIES) {
        throw new MaxCategoriesError();
      }

      if (await findDuplicate(userId, input.name)) {
        throw new DuplicateCategoryError(input.name);
      }

      try {
        const result = await db.query(
          `INSERT INTO custom_categories (user_id, name, color, sort_order)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, color, sort_order`,
          [userId, input.name, input.color, input.sortOrder ?? 0]
        );

        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          color: row.color,
          sortOrder: row.sort_order,
          isDefault: false,
        };
      } catch (err: any) {
        if (err.code === "23505") {
          throw new DuplicateCategoryError(input.name);
        }
        throw err;
      }
    },

    async updateCategory(
      userId: string,
      categoryId: string,
      input: UpdateCategoryInput
    ): Promise<CategoryRecord> {
      const existing = await db.query(
        `SELECT id, name FROM custom_categories
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [categoryId, userId]
      );

      if (!existing.rows[0]) {
        throw new CategoryNotFoundError();
      }

      if (input.name && (await findDuplicate(userId, input.name, categoryId))) {
        throw new DuplicateCategoryError(input.name);
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${idx++}`);
        params.push(input.name);
      }
      if (input.color !== undefined) {
        updates.push(`color = $${idx++}`);
        params.push(input.color);
      }
      if (input.sortOrder !== undefined) {
        updates.push(`sort_order = $${idx++}`);
        params.push(input.sortOrder);
      }
      updates.push(`updated_at = NOW()`);
      params.push(categoryId, userId);

      const result = await db.query(
        `UPDATE custom_categories SET ${updates.join(", ")}
         WHERE id = $${idx++} AND user_id = $${idx} AND deleted_at IS NULL
         RETURNING id, name, color, sort_order`,
        params
      );

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        sortOrder: row.sort_order,
        isDefault: false,
      };
    },

    async deleteCategory(userId: string, categoryId: string): Promise<void> {
      const result = await db.query(
        `UPDATE custom_categories SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [categoryId, userId]
      );

      if (!result.rows[0]) {
        throw new CategoryNotFoundError();
      }
    },

    async getCustomCategoryNames(userId: string): Promise<string[]> {
      const result = await db.query(
        `SELECT name FROM custom_categories
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order`,
        [userId]
      );
      return result.rows.map((row) => row.name);
    },
  };
};
