import { DEFAULT_CATEGORIES } from "../categorization/claude.client";

export const MAX_CUSTOM_CATEGORIES = 20;

export const DEFAULT_CATEGORY_META: Record<
  string,
  { color: string; sortOrder: number }
> = {
  work: { color: "#3b82f6", sortOrder: 0 },
  family: { color: "#10b981", sortOrder: 1 },
  errands: { color: "#f59e0b", sortOrder: 2 },
  ideas: { color: "#8b5cf6", sortOrder: 3 },
  health: { color: "#ef4444", sortOrder: 4 },
  finance: { color: "#06b6d4", sortOrder: 5 },
};

export const buildDefaultCategoryList = () =>
  DEFAULT_CATEGORIES.map((name) => ({
    id: null as string | null,
    name,
    color: DEFAULT_CATEGORY_META[name]?.color ?? "#6366f1",
    sortOrder: DEFAULT_CATEGORY_META[name]?.sortOrder ?? 0,
    isDefault: true,
  }));
