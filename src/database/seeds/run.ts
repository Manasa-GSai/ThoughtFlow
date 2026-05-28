import { getPool, closePool } from "../config/connection";
import * as dotenv from "dotenv";

dotenv.config();

const seedData = async (): Promise<void> => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const freeUser = await client.query(`
      INSERT INTO users (id, email, password_hash, display_name, tier, role)
      VALUES (
        'a0000000-0000-0000-0000-000000000001',
        'sarah@example.com',
        '$2b$12$placeholder.hash.for.development.only',
        'Sarah (Free Tier)',
        'free',
        'user'
      ) ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);

    const proUser = await client.query(`
      INSERT INTO users (id, email, password_hash, display_name, tier, role)
      VALUES (
        'a0000000-0000-0000-0000-000000000002',
        'marcus@example.com',
        '$2b$12$placeholder.hash.for.development.only',
        'Marcus (Pro Tier)',
        'pro',
        'user'
      ) ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);

    const enterpriseUser = await client.query(`
      INSERT INTO users (id, email, password_hash, display_name, tier, role)
      VALUES (
        'a0000000-0000-0000-0000-000000000003',
        'admin@thoughtflow.app',
        '$2b$12$placeholder.hash.for.development.only',
        'Admin (Enterprise)',
        'enterprise',
        'admin'
      ) ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);

    const proUserId = "a0000000-0000-0000-0000-000000000002";

    await client.query(`
      INSERT INTO thoughts (id, user_id, raw_text, transcription_source, category, ai_confidence_score, status)
      VALUES
        ('b0000000-0000-0000-0000-000000000001', $1, 'Remember to review the Q3 budget proposal before Friday meeting', 'voice', 'work', 0.92, 'categorized'),
        ('b0000000-0000-0000-0000-000000000002', $1, 'Pick up groceries after work. Need milk, eggs, and bread', 'voice', 'errands', 0.88, 'categorized'),
        ('b0000000-0000-0000-0000-000000000003', $1, 'Idea for the garden: build a raised bed along the south fence', 'typed', 'ideas', 0.95, 'categorized'),
        ('b0000000-0000-0000-0000-000000000004', $1, 'Schedule parent-teacher conference for next Tuesday', 'voice', 'family', 0.91, 'categorized'),
        ('b0000000-0000-0000-0000-000000000005', $1, 'New thought about improving the onboarding flow', 'typed', null, null, 'pending')
      ON CONFLICT DO NOTHING
    `, [proUserId]);

    await client.query(`
      INSERT INTO action_items (id, thought_id, user_id, task, priority, due_date, completed)
      VALUES
        ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', $1, 'Review Q3 budget proposal', 'high', CURRENT_DATE + INTERVAL '2 days', false),
        ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', $1, 'Buy milk, eggs, and bread', 'medium', CURRENT_DATE, false),
        ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004', $1, 'Schedule parent-teacher conference', 'high', CURRENT_DATE + INTERVAL '5 days', false)
      ON CONFLICT DO NOTHING
    `, [proUserId]);

    await client.query(`
      INSERT INTO custom_categories (id, user_id, name, color, sort_order)
      VALUES
        ('d0000000-0000-0000-0000-000000000001', $1, 'work', '#3b82f6', 1),
        ('d0000000-0000-0000-0000-000000000002', $1, 'family', '#10b981', 2),
        ('d0000000-0000-0000-0000-000000000003', $1, 'errands', '#f59e0b', 3),
        ('d0000000-0000-0000-0000-000000000004', $1, 'ideas', '#8b5cf6', 4)
      ON CONFLICT DO NOTHING
    `, [proUserId]);

    await client.query(`
      INSERT INTO audit_log (user_id, entity_type, entity_id, action, new_value)
      VALUES
        ($1, 'thought', 'b0000000-0000-0000-0000-000000000001', 'create', '{"raw_text": "Remember to review the Q3 budget proposal before Friday meeting"}'),
        ($1, 'thought', 'b0000000-0000-0000-0000-000000000001', 'categorize', '{"category": "work", "confidence": 0.92}')
    `, [proUserId]);

    await client.query("COMMIT");
    console.log("✅ Seed data inserted successfully");
    console.log("   - 3 users (free, pro, enterprise)");
    console.log("   - 5 thoughts for pro user");
    console.log("   - 3 action items");
    console.log("   - 4 custom categories");
    console.log("   - 2 audit log entries");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed:", error);
    throw error;
  } finally {
    client.release();
    await closePool();
  }
};

seedData().catch((err) => {
  console.error(err);
  process.exit(1);
});
