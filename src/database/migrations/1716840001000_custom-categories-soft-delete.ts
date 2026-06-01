import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("custom_categories", {
    deleted_at: { type: "timestamptz" },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.dropConstraint("custom_categories", "unique_user_category_name");

  pgm.sql(`
    CREATE UNIQUE INDEX unique_user_category_name_active
      ON custom_categories (user_id, name)
      WHERE deleted_at IS NULL;
  `);

  pgm.sql(`
    CREATE TRIGGER set_updated_at_custom_categories
      BEFORE UPDATE ON custom_categories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DROP TRIGGER IF EXISTS set_updated_at_custom_categories ON custom_categories");
  pgm.sql("DROP INDEX IF EXISTS unique_user_category_name_active");

  pgm.addConstraint("custom_categories", "unique_user_category_name", {
    unique: ["user_id", "name"],
  });

  pgm.dropColumns("custom_categories", ["deleted_at", "updated_at"]);
}
