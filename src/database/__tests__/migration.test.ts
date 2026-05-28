import { up, down } from "../migrations/1716840000000_initial-schema";

const mockPgm = () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const recorder = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };

  return {
    pgm: {
      sql: recorder("sql"),
      createType: recorder("createType"),
      createTable: recorder("createTable"),
      createIndex: recorder("createIndex"),
      addConstraint: recorder("addConstraint"),
      dropTable: recorder("dropTable"),
      dropType: recorder("dropType"),
      func: (val: string) => ({ toString: () => val }),
    } as any,
    calls,
  };
};

describe("Initial Schema Migration", () => {
  describe("up migration", () => {
    it("creates all required tables in correct order", async () => {
      const { pgm, calls } = mockPgm();
      await up(pgm);

      const createTableCalls = calls
        .filter((c) => c.method === "createTable")
        .map((c) => c.args[0]);

      expect(createTableCalls).toContain("users");
      expect(createTableCalls).toContain("thoughts");
      expect(createTableCalls).toContain("action_items");
      expect(createTableCalls).toContain("custom_categories");
      expect(createTableCalls).toContain("audit_log");

      const usersIdx = createTableCalls.indexOf("users");
      const thoughtsIdx = createTableCalls.indexOf("thoughts");
      const actionItemsIdx = createTableCalls.indexOf("action_items");
      expect(usersIdx).toBeLessThan(thoughtsIdx);
      expect(thoughtsIdx).toBeLessThan(actionItemsIdx);
    });

    it("creates all required enum types", async () => {
      const { pgm, calls } = mockPgm();
      await up(pgm);

      const typeNames = calls
        .filter((c) => c.method === "createType")
        .map((c) => c.args[0]);

      expect(typeNames).toContain("user_tier");
      expect(typeNames).toContain("user_role");
      expect(typeNames).toContain("transcription_source");
      expect(typeNames).toContain("thought_status");
      expect(typeNames).toContain("action_priority");
    });

    it("creates performance indexes", async () => {
      const { pgm, calls } = mockPgm();
      await up(pgm);

      const indexCalls = calls.filter((c) => c.method === "createIndex");
      expect(indexCalls.length).toBeGreaterThanOrEqual(8);

      const indexTargets = indexCalls.map((c) => ({
        table: c.args[0],
        columns: c.args[1],
      }));

      expect(indexTargets).toContainEqual({
        table: "thoughts",
        columns: ["user_id", "created_at"],
      });
      expect(indexTargets).toContainEqual({
        table: "thoughts",
        columns: ["user_id", "category"],
      });
      expect(indexTargets).toContainEqual({
        table: "action_items",
        columns: ["user_id", "due_date", "completed"],
      });
      expect(indexTargets).toContainEqual({
        table: "action_items",
        columns: "thought_id",
      });
      expect(indexTargets).toContainEqual({
        table: "audit_log",
        columns: ["user_id", "timestamp"],
      });
    });

    it("adds unique constraint on custom_categories(user_id, name)", async () => {
      const { pgm, calls } = mockPgm();
      await up(pgm);

      const constraintCalls = calls.filter(
        (c) => c.method === "addConstraint"
      );
      expect(constraintCalls).toHaveLength(1);
      expect(constraintCalls[0].args[0]).toBe("custom_categories");
      expect(constraintCalls[0].args[2]).toEqual({
        unique: ["user_id", "name"],
      });
    });

    it("creates audit_log protection rules via SQL", async () => {
      const { pgm, calls } = mockPgm();
      await up(pgm);

      const sqlCalls = calls
        .filter((c) => c.method === "sql")
        .map((c) => c.args[0] as string);

      const hasNoUpdate = sqlCalls.some((s) =>
        s.includes("audit_log_no_update")
      );
      const hasNoDelete = sqlCalls.some((s) =>
        s.includes("audit_log_no_delete")
      );

      expect(hasNoUpdate).toBe(true);
      expect(hasNoDelete).toBe(true);
    });
  });

  describe("down migration", () => {
    it("drops all tables in reverse dependency order", async () => {
      const { pgm, calls } = mockPgm();
      await down(pgm);

      const dropTableCalls = calls
        .filter((c) => c.method === "dropTable")
        .map((c) => c.args[0]);

      expect(dropTableCalls).toContain("audit_log");
      expect(dropTableCalls).toContain("custom_categories");
      expect(dropTableCalls).toContain("action_items");
      expect(dropTableCalls).toContain("thoughts");
      expect(dropTableCalls).toContain("users");

      const auditIdx = dropTableCalls.indexOf("audit_log");
      const usersIdx = dropTableCalls.indexOf("users");
      expect(auditIdx).toBeLessThan(usersIdx);
    });

    it("drops all enum types", async () => {
      const { pgm, calls } = mockPgm();
      await down(pgm);

      const dropTypeNames = calls
        .filter((c) => c.method === "dropType")
        .map((c) => c.args[0]);

      expect(dropTypeNames).toContain("user_tier");
      expect(dropTypeNames).toContain("user_role");
      expect(dropTypeNames).toContain("transcription_source");
      expect(dropTypeNames).toContain("thought_status");
      expect(dropTypeNames).toContain("action_priority");
    });

    it("removes audit log protection rules before dropping table", async () => {
      const { pgm, calls } = mockPgm();
      await down(pgm);

      const sqlCalls = calls
        .filter((c) => c.method === "sql")
        .map((c) => c.args[0] as string);

      const dropNoUpdate = sqlCalls.findIndex((s) =>
        s.includes("DROP RULE IF EXISTS audit_log_no_update")
      );
      const dropNoDelete = sqlCalls.findIndex((s) =>
        s.includes("DROP RULE IF EXISTS audit_log_no_delete")
      );
      const dropAuditTable = calls.findIndex(
        (c) => c.method === "dropTable" && c.args[0] === "audit_log"
      );

      expect(dropNoUpdate).toBeLessThan(dropAuditTable);
      expect(dropNoDelete).toBeLessThan(dropAuditTable);
    });
  });

  describe("idempotency", () => {
    it("up migration can be called without throwing", async () => {
      const { pgm } = mockPgm();
      await expect(up(pgm)).resolves.not.toThrow();
    });

    it("down migration can be called without throwing", async () => {
      const { pgm } = mockPgm();
      await expect(down(pgm)).resolves.not.toThrow();
    });

    it("up then down then up produces consistent state", async () => {
      const mock1 = mockPgm();
      await up(mock1.pgm);
      const firstUpCalls = mock1.calls.length;

      const mock2 = mockPgm();
      await down(mock2.pgm);

      const mock3 = mockPgm();
      await up(mock3.pgm);
      const secondUpCalls = mock3.calls.length;

      expect(firstUpCalls).toBe(secondUpCalls);
    });
  });
});
