import type { Overlay, OverlayContext } from "../pipeline.js";
import {
  isRequest,
  makeErrorResponse,
  RpcErrorCode,
  type JsonRpcMessage,
} from "../rpc.js";

export interface SqlGuardConfig {
  /** Tool names whose calls are inspected. */
  tools: string[];
  /** Name of the argument carrying the SQL string. Default "sql". */
  sqlArg?: string;
  /** When false the overlay is inert. Default true. */
  readOnly?: boolean;
  /** "allowlist" (default) checks the leading verb; "denylist" scans for write keywords. */
  mode?: "allowlist" | "denylist";
  /** Extra write keywords, used only in denylist mode. */
  extraWriteKeywords?: string[];
  /** Extra read verbs, used only in allowlist mode. */
  extraReadVerbs?: string[];
}

// Verbs that may lead a statement in allowlist mode (FR-SQL-010).
const ALLOWED_LEADING_VERBS = [
  "SELECT",
  "WITH",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "VALUES",
  "PRAGMA",
  "TABLE",
];

// Keywords that mark a write in denylist mode (FR-SQL-020).
const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "MERGE",
  "REPLACE",
  "RENAME",
  "COMMENT",
  "LOCK",
  "CALL",
  "EXEC",
  "EXECUTE",
  "DO",
];

// 1 MB cap defeats DoS via pathologically long input (FR-SQL-053 / NFR-PERF-005).
const MAX_SQL_BYTES = 1024 * 1024;

interface SplitStatement {
  /** Raw text, used for the rejection message. */
  original: string;
  /** Comment-stripped, literal-blanked text, used for analysis. */
  sanitized: string;
}

// Zero-width and format characters that could be hidden inside keywords (FR-SQL-051):
// ZWSP/ZWNJ/ZWJ (U+200B-200D), word joiner (U+2060), BOM (U+FEFF), soft hyphen (U+00AD).
const INVISIBLE = new RegExp("[\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]", "g");

function normalizeForAnalysis(sql: string): string {
  // NFKC folds fullwidth/compatibility forms (e.g. "ＤＲＯＰ" -> "DROP") so
  // unicode look-alikes can't smuggle a write keyword past the scanner.
  return sql.normalize("NFKC").replace(INVISIBLE, "");
}

/**
 * Walk the SQL once, classifying every character so that comments are stripped,
 * string-literal contents are blanked (delimiters kept), and `;` only splits
 * statements when it is NOT inside a string or comment. Only standard `''` /
 * `""` escaping is honored — backslash escapes are deliberately ignored so the
 * guard fails closed rather than mis-reading a closed string as still-open.
 */
function sanitizeAndSplit(sql: string): SplitStatement[] {
  const statements: SplitStatement[] = [];
  let original = "";
  let sanitized = "";

  type State = "normal" | "line" | "block" | "single" | "double" | "dollar";
  let state: State = "normal";
  let blockDepth = 0;
  let dollarTag = "";

  const flush = () => {
    if (original.trim().length > 0) {
      statements.push({ original, sanitized });
    }
    original = "";
    sanitized = "";
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    switch (state) {
      case "normal": {
        if (c === "-" && next === "-") {
          state = "line";
          original += "--";
          sanitized += "  ";
          i += 2;
          continue;
        }
        if (c === "/" && next === "*") {
          state = "block";
          blockDepth = 1;
          original += "/*";
          sanitized += "  ";
          i += 2;
          continue;
        }
        if (c === "'") {
          state = "single";
          original += c;
          sanitized += c;
          i += 1;
          continue;
        }
        if (c === '"') {
          state = "double";
          original += c;
          sanitized += c;
          i += 1;
          continue;
        }
        if (c === "$") {
          const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
          if (m) {
            state = "dollar";
            dollarTag = m[0];
            original += m[0];
            sanitized += m[0];
            i += m[0].length;
            continue;
          }
        }
        if (c === ";") {
          original += c;
          flush();
          i += 1;
          continue;
        }
        original += c;
        sanitized += c;
        i += 1;
        continue;
      }

      case "line": {
        original += c;
        if (c === "\n") {
          sanitized += "\n";
          state = "normal";
        } else {
          sanitized += " ";
        }
        i += 1;
        continue;
      }

      case "block": {
        if (c === "/" && next === "*") {
          blockDepth += 1;
          original += "/*";
          sanitized += "  ";
          i += 2;
          continue;
        }
        if (c === "*" && next === "/") {
          blockDepth -= 1;
          original += "*/";
          sanitized += "  ";
          i += 2;
          if (blockDepth === 0) state = "normal";
          continue;
        }
        original += c;
        sanitized += " ";
        i += 1;
        continue;
      }

      case "single": {
        if (c === "'" && next === "'") {
          original += "''";
          sanitized += "  ";
          i += 2;
          continue;
        }
        if (c === "'") {
          state = "normal";
          original += c;
          sanitized += c;
          i += 1;
          continue;
        }
        original += c;
        sanitized += " ";
        i += 1;
        continue;
      }

      case "double": {
        if (c === '"' && next === '"') {
          original += '""';
          sanitized += "  ";
          i += 2;
          continue;
        }
        if (c === '"') {
          state = "normal";
          original += c;
          sanitized += c;
          i += 1;
          continue;
        }
        original += c;
        sanitized += " ";
        i += 1;
        continue;
      }

      case "dollar": {
        if (c === "$" && sql.startsWith(dollarTag, i)) {
          state = "normal";
          original += dollarTag;
          sanitized += dollarTag;
          i += dollarTag.length;
          continue;
        }
        original += c;
        sanitized += " ";
        i += 1;
        continue;
      }
    }
  }

  flush();
  return statements;
}

function analyzeStatement(
  sanitized: string,
  mode: "allowlist" | "denylist",
  allowVerbs: Set<string>,
  denyKeywords: string[],
): string | null {
  // FR-SQL-032: collapse whitespace to single spaces before analysis.
  const normalized = sanitized.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;

  if (mode === "allowlist") {
    const m = /^[\s(]*([a-zA-Z]+)/.exec(normalized);
    const verb = m ? m[1].toUpperCase() : "";
    if (!allowVerbs.has(verb)) {
      return `leading verb '${verb || "?"}' is not allowed in allowlist mode`;
    }
    return null;
  }

  for (const kw of denyKeywords) {
    // FR-SQL-021: word-boundary aware, so "update" inside "updated_at" is fine.
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(normalized)) {
      return `write keyword '${kw.toUpperCase()}' is not allowed in denylist mode`;
    }
  }
  return null;
}

export function createSqlGuardOverlay(config: SqlGuardConfig): Overlay {
  const sqlArg = config.sqlArg ?? "sql";
  const readOnly = config.readOnly ?? true;
  const mode = config.mode ?? "allowlist";
  const toolSet = new Set(config.tools);

  const allowVerbs = new Set<string>([
    ...ALLOWED_LEADING_VERBS,
    ...(config.extraReadVerbs ?? []).map((v) => v.toUpperCase()),
  ]);
  const denyKeywords = [
    ...WRITE_KEYWORDS,
    ...(config.extraWriteKeywords ?? []).map((k) => k.toUpperCase()),
  ];

  return {
    name: "sqlGuard",
    // Gate: a thrown error fails closed (pipeline responds with an error
    // rather than forwarding an un-inspected write).
    kind: "gate",

    onClientMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      // FR-SQL-003: readOnly:false makes the overlay inert.
      if (!readOnly) return;
      if (!isRequest(msg)) return;
      if (msg.method !== "tools/call") return;

      const params = msg.params as
        | { name?: unknown; arguments?: unknown }
        | undefined;
      const name = typeof params?.name === "string" ? params.name : null;
      if (name === null || !toolSet.has(name)) return;

      const args = params?.arguments;
      const sql =
        typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)[sqlArg]
          : undefined;
      // Nothing to inspect — let it through (the tool itself will fail if it
      // truly needed the arg).
      if (typeof sql !== "string") return;

      if (sql.length > MAX_SQL_BYTES) {
        const errMsg = `sqlGuard: tool "${name}" rejected: SQL input exceeds ${MAX_SQL_BYTES}-byte limit`;
        ctx.log("warn", errMsg);
        return {
          respond: makeErrorResponse(msg.id, RpcErrorCode.InvalidParams, errMsg),
        };
      }

      const statements = sanitizeAndSplit(normalizeForAnalysis(sql));
      for (const st of statements) {
        const reason = analyzeStatement(
          st.sanitized,
          mode,
          allowVerbs,
          denyKeywords,
        );
        if (reason === null) continue;

        const offending = st.original.trim().slice(0, 200);
        const errMsg = `sqlGuard: tool "${name}" rejected: ${reason}. Offending statement: ${offending}`;
        ctx.log("info", errMsg);
        return {
          respond: makeErrorResponse(msg.id, RpcErrorCode.InvalidParams, errMsg),
        };
      }

      return;
    },
  };
}
