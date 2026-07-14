import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("action_items", {
    deleted_at: { type: "timestamptz" },
  });

  pgm.createIndex("action_items", ["user_id", "deleted_at"], {
    where: "deleted_at IS NULL",
    name: "idx_action_items_active_user",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("action_items", [], { name: "idx_action_items_active_user" });
  pgm.dropColumns("action_items", ["deleted_at"]);
}
