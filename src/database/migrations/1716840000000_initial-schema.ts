import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  pgm.createType("user_tier", ["free", "pro", "enterprise"]);
  pgm.createType("user_role", ["user", "admin"]);
  pgm.createType("transcription_source", ["voice", "typed"]);
  pgm.createType("thought_status", [
    "pending",
    "transcribed",
    "categorized",
    "failed",
  ]);
  pgm.createType("action_priority", ["high", "medium", "low"]);

  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    email: { type: "varchar(255)", notNull: true, unique: true },
    password_hash: { type: "varchar(255)", notNull: true },
    display_name: { type: "varchar(100)", notNull: true },
    tier: { type: "user_tier", notNull: true, default: "free" },
    role: { type: "user_role", notNull: true, default: "user" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    deleted_at: { type: "timestamptz" },
  });

  pgm.createTable("thoughts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    raw_text: { type: "text" },
    transcription_source: { type: "transcription_source", notNull: true },
    category: { type: "varchar(100)" },
    ai_confidence_score: { type: "decimal(4,3)" },
    status: { type: "thought_status", notNull: true, default: "pending" },
    version: { type: "integer", notNull: true, default: 1 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("action_items", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    thought_id: {
      type: "uuid",
      notNull: true,
      references: "thoughts",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    task: { type: "text", notNull: true },
    priority: { type: "action_priority", notNull: true, default: "medium" },
    due_date: { type: "date" },
    completed: { type: "boolean", notNull: true, default: false },
    completed_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("custom_categories", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("uuid_generate_v4()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    name: { type: "varchar(100)", notNull: true },
    color: { type: "varchar(7)", default: "#6366f1" },
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("custom_categories", "unique_user_category_name", {
    unique: ["user_id", "name"],
  });

  pgm.createTable("audit_log", {
    id: {
      type: "bigserial",
      primaryKey: true,
    },
    user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    entity_type: { type: "varchar(50)", notNull: true },
    entity_id: { type: "uuid", notNull: true },
    action: { type: "varchar(50)", notNull: true },
    old_value: { type: "jsonb" },
    new_value: { type: "jsonb" },
    ip_address: { type: "inet" },
    timestamp: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("users", "email");
  pgm.createIndex("users", "deleted_at", {
    where: "deleted_at IS NULL",
    name: "idx_users_active",
  });
  pgm.createIndex("thoughts", ["user_id", "created_at"]);
  pgm.createIndex("thoughts", ["user_id", "category"]);
  pgm.createIndex("thoughts", ["user_id", "status"]);
  pgm.createIndex("action_items", ["user_id", "due_date", "completed"]);
  pgm.createIndex("action_items", "thought_id");
  pgm.createIndex("audit_log", ["user_id", "timestamp"]);
  pgm.createIndex("audit_log", ["entity_type", "entity_id"]);
  pgm.createIndex("custom_categories", ["user_id", "sort_order"]);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER set_updated_at_users
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `);
  pgm.sql(`
    CREATE TRIGGER set_updated_at_thoughts
      BEFORE UPDATE ON thoughts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `);
  pgm.sql(`
    CREATE TRIGGER set_updated_at_action_items
      BEFORE UPDATE ON action_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `);

  pgm.sql(`
    CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log
    DO INSTEAD NOTHING;
  `);
  pgm.sql(`
    CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log
    DO INSTEAD NOTHING;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DROP RULE IF EXISTS audit_log_no_delete ON audit_log");
  pgm.sql("DROP RULE IF EXISTS audit_log_no_update ON audit_log");

  pgm.sql("DROP TRIGGER IF EXISTS set_updated_at_action_items ON action_items");
  pgm.sql("DROP TRIGGER IF EXISTS set_updated_at_thoughts ON thoughts");
  pgm.sql("DROP TRIGGER IF EXISTS set_updated_at_users ON users");
  pgm.sql("DROP FUNCTION IF EXISTS update_updated_at()");

  pgm.dropTable("audit_log");
  pgm.dropTable("custom_categories");
  pgm.dropTable("action_items");
  pgm.dropTable("thoughts");
  pgm.dropTable("users");

  pgm.dropType("action_priority");
  pgm.dropType("thought_status");
  pgm.dropType("transcription_source");
  pgm.dropType("user_role");
  pgm.dropType("user_tier");
}
