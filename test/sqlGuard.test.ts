import { describe, it, expect } from "vitest";
import { createSqlGuardOverlay } from "../src/overlays/sqlGuard.js";
import type { OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

function makeCtx(): OverlayContext {
  return { log: () => {}, state: {} };
}

function call(
  id: number,
  name: string,
  args: Record<string, unknown>,
): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

// Convenience: run a SQL string through a query-guarded overlay and return the
// MessageResult (undefined = allowed, { respond } = rejected).
function run(
  overlay: ReturnType<typeof createSqlGuardOverlay>,
  sql: string,
  arg = "sql",
) {
  return overlay.onClientMessage!(
    call(1, "query", { [arg]: sql }),
    makeCtx(),
  );
}

const allowlist = () => createSqlGuardOverlay({ tools: ["query"] });

describe("createSqlGuardOverlay", () => {
  describe("metadata", () => {
    it("has name 'sqlGuard' and kind 'gate'", () => {
      const overlay = createSqlGuardOverlay({ tools: ["query"] });
      expect(overlay.name).toBe("sqlGuard");
      expect(overlay.kind).toBe("gate");
    });
  });

  describe("scope", () => {
    it("ignores tools/call for non-guarded tools", () => {
      const overlay = allowlist();
      const result = overlay.onClientMessage!(
        call(1, "other", { sql: "DROP TABLE x" }),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores non-tools/call requests", () => {
      const overlay = allowlist();
      const result = overlay.onClientMessage!(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores notifications (no id)", () => {
      const overlay = allowlist();
      const result = overlay.onClientMessage!(
        { jsonrpc: "2.0", method: "tools/call", params: { name: "query" } },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("allows the call when the sql argument is absent", () => {
      const overlay = allowlist();
      const result = overlay.onClientMessage!(
        call(1, "query", { notSql: "DROP TABLE x" }),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("inspects a custom sqlArg", () => {
      const overlay = createSqlGuardOverlay({
        tools: ["query"],
        sqlArg: "statement",
      });
      const result = run(overlay, "DELETE FROM users", "statement");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });
  });

  describe("readOnly:false (inert)", () => {
    it("does nothing when readOnly is false", () => {
      const overlay = createSqlGuardOverlay({
        tools: ["query"],
        readOnly: false,
      });
      const result = run(overlay, "DROP TABLE users");
      expect(result).toBeUndefined();
    });
  });

  describe("allowlist mode (default)", () => {
    it("allows SELECT", () => {
      expect(run(allowlist(), "SELECT * FROM users")).toBeUndefined();
    });

    it("allows WITH, SHOW, EXPLAIN, PRAGMA case-insensitively", () => {
      const overlay = allowlist();
      expect(run(overlay, "with x as (select 1) select * from x")).toBeUndefined();
      expect(run(overlay, "show tables")).toBeUndefined();
      expect(run(overlay, "EXPLAIN SELECT 1")).toBeUndefined();
      expect(run(overlay, "pragma table_info(users)")).toBeUndefined();
    });

    it("rejects a leading UPDATE with -32602 (UC-5)", () => {
      const result = run(allowlist(), "UPDATE users SET banned = true");
      expect(result).toMatchObject({
        respond: { error: { code: -32602 } },
      });
      const msg = (result as { respond: { error: { message: string } } })
        .respond.error.message;
      expect(msg).toContain("query");
      expect(msg).toContain("UPDATE");
    });

    it("rejects an unknown leading verb", () => {
      const result = run(allowlist(), "FROBNICATE the_table");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });

    it("honors extraReadVerbs", () => {
      const overlay = createSqlGuardOverlay({
        tools: ["query"],
        extraReadVerbs: ["ANALYZE"],
      });
      expect(run(overlay, "ANALYZE users")).toBeUndefined();
    });

    it("allows a leading parenthesis before SELECT", () => {
      expect(run(allowlist(), "(SELECT 1) UNION (SELECT 2)")).toBeUndefined();
    });
  });

  describe("denylist mode", () => {
    const denylist = () =>
      createSqlGuardOverlay({ tools: ["query"], mode: "denylist" });

    it("allows a plain SELECT", () => {
      expect(run(denylist(), "SELECT * FROM users")).toBeUndefined();
    });

    it("rejects a statement containing DELETE", () => {
      const result = run(denylist(), "SELECT 1; DELETE FROM users");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });

    it("does NOT match 'update' inside 'updated_at' (word boundary)", () => {
      expect(
        run(denylist(), "SELECT updated_at FROM users"),
      ).toBeUndefined();
    });

    it("honors extraWriteKeywords", () => {
      const overlay = createSqlGuardOverlay({
        tools: ["query"],
        mode: "denylist",
        extraWriteKeywords: ["VACUUM"],
      });
      expect(run(overlay, "VACUUM users")).toMatchObject({
        respond: { error: { code: -32602 } },
      });
    });
  });

  describe("multi-statement", () => {
    it("rejects the whole request if any statement fails", () => {
      const result = run(allowlist(), "SELECT 1; DROP TABLE x");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });

    it("allows when every statement passes", () => {
      expect(run(allowlist(), "SELECT 1; SELECT 2;")).toBeUndefined();
    });

    it("ignores a trailing empty statement after the last semicolon", () => {
      expect(run(allowlist(), "SELECT 1;   ")).toBeUndefined();
    });
  });

  describe("comment stripping (FR-SQL-030/050)", () => {
    it("rejects a write hidden after a block comment (AC-7)", () => {
      const result = run(
        allowlist(),
        "SELECT 1; /* UPDATE users SET banned=true */ DROP TABLE x;",
      );
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
      const msg = (result as { respond: { error: { message: string } } })
        .respond.error.message;
      // The offending statement is the DROP, not the commented-out UPDATE.
      expect(msg).toContain("DROP");
    });

    it("strips line comments before analysis", () => {
      expect(
        run(allowlist(), "SELECT 1 -- DROP TABLE x\n"),
      ).toBeUndefined();
    });

    it("handles nested block comments", () => {
      // The DROP is fully enclosed by nested comments, so only SELECT remains.
      expect(
        run(allowlist(), "SELECT 1 /* outer /* DROP */ still comment */"),
      ).toBeUndefined();
    });
  });

  describe("string-literal blanking (FR-SQL-031)", () => {
    it("allows keywords that appear only inside a string literal (AC-8)", () => {
      const result = run(
        allowlist(),
        "SELECT * FROM users WHERE name = 'O''Brien -- not a comment'",
      );
      expect(result).toBeUndefined();
    });

    it("does not split on a semicolon inside a string literal", () => {
      expect(
        run(allowlist(), "SELECT 'a; DROP TABLE x' AS note"),
      ).toBeUndefined();
    });

    it("blanks dollar-quoted contents", () => {
      expect(
        run(allowlist(), "SELECT $$ DROP TABLE x $$ AS note"),
      ).toBeUndefined();
    });
  });

  describe("evasion resistance", () => {
    it("rejects a Postgres DO block (FR-SQL-052)", () => {
      const result = run(
        allowlist(),
        "DO $$ BEGIN UPDATE users SET x = 1; END $$;",
      );
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });

    it("rejects zero-width-space obfuscation of a keyword (FR-SQL-051)", () => {
      // "DR<ZWSP>OP TABLE x" — the zero-width space must be stripped so the
      // leading verb resolves to DROP.
      const result = run(allowlist(), "DR​OP TABLE x");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });

    it("rejects fullwidth-unicode obfuscation via NFKC folding", () => {
      // "ＤＲＯＰ TABLE x" using fullwidth letters folds to "DROP".
      const result = run(allowlist(), "ＤＲＯＰ TABLE x");
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
    });
  });

  describe("DoS guard (FR-SQL-053)", () => {
    it("rejects input larger than 1 MB", () => {
      const big = "SELECT " + "a".repeat(1024 * 1024 + 10);
      const result = run(allowlist(), big);
      expect(result).toMatchObject({ respond: { error: { code: -32602 } } });
      const msg = (result as { respond: { error: { message: string } } })
        .respond.error.message;
      expect(msg).toContain("limit");
    });
  });
});
