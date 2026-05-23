# JanuScope — Complete Scope & Build-From-Scratch Specification

> **Purpose of this document:** A full, self-contained feature inventory and engineering scope for rebuilding JanuScope from scratch. Every capability currently in the codebase is captured below so the rebuild can be planned, estimated, and implemented without referring back to the original source.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Core Engine Components](#4-core-engine-components)
5. [The 9 Policy Overlays](#5-the-9-policy-overlays)
6. [Configuration Schema (Lens YAML)](#6-configuration-schema-lens-yaml)
7. [Command-Line Interface](#7-command-line-interface)
8. [Lens Library](#8-lens-library)
9. [Security & Trust Model](#9-security--trust-model)
10. [Observability & Telemetry](#10-observability--telemetry)
11. [Testing Strategy](#11-testing-strategy)
12. [Tooling, Build & Release](#12-tooling-build--release)
13. [Distribution & Packaging](#13-distribution--packaging)
14. [Design Principles to Preserve](#14-design-principles-to-preserve)
15. [Suggested Build Order](#15-suggested-build-order)
16. [Effort Estimate](#16-effort-estimate)
17. [Glossary](#17-glossary)

---

## 1. Project Overview

### 1.1 What It Is

JanuScope is a **local MCP (Model Context Protocol) policy proxy**. It sits between an AI client (Claude, Cursor, Copilot, etc.) and any MCP server, wrapping that server with policy enforcement — security gates, audit logging, PII redaction, rate limiting, schema injection, and more — defined entirely in a single YAML config file called a "Lens".

It is launched as a short-lived child process per client connection. There is no daemon, no hosted gateway, no shared state across sessions. The entire tool stays on the operator's machine.

### 1.2 The Problem It Solves

MCP servers by default expose powerful, often-destructive tools (`execute_sql`, `drop_table`, `delete_file`, `create_pr`, etc.) with:

- **Zero audit logging** of what the LLM actually called and with what arguments
- **No filtering** of dangerous tools
- **No PII protection** on returned data
- **No rate limits** to prevent runaway agent loops
- **No schema awareness** — agents must blindly discover the DB schema via round-trips
- **No drift detection** — a compromised MCP can quietly change its tool surface

JanuScope is the policy layer that fixes all of the above without requiring any changes to the upstream MCP server.

### 1.3 Key Properties

| Property | Value |
|---|---|
| **Runtime model** | Short-lived child process per client connection |
| **Transport** | Stdio (line-delimited JSON-RPC 2.0) |
| **Config format** | YAML (or JSON), single file |
| **Target invocation** | Spawns target MCP as a child process |
| **Remote MCPs** | Supported via `mcp-remote` bridge (still a child process) |
| **Data path** | Stays 100% local; no cloud, no telemetry by default |
| **License model** | AGPL-3.0 (primary) + Commercial license available |
| **LOC** | ~5,000 lines TypeScript |

---

## 2. Tech Stack

### 2.1 Runtime & Language

- **Node.js** ≥ 20.0.0
- **TypeScript** with ESM modules (`"type": "module"` in package.json)
- Target output: `ES2020`, module `ES2020`, strict mode

### 2.2 Required Dependencies

| Package | Purpose |
|---|---|
| `js-yaml` | YAML config parsing |
| `zod` | Runtime schema validation |

### 2.3 Optional Peer Dependencies (lazy-loaded)

| Package | Required For |
|---|---|
| `better-sqlite3` | SQLite introspection in `dbSchema` overlay |
| `mysql2` | MySQL introspection in `dbSchema` overlay |
| `pg` | PostgreSQL introspection in `dbSchema` overlay |
| `@opentelemetry/*` SDKs | OTel telemetry export |
| Vault / AWS SDK / 1Password CLI | Secret backend resolution |

### 2.4 Dev Stack

| Tool | Version Range | Purpose |
|---|---|---|
| TypeScript | ^6.x | Compilation, type checking |
| Vitest | ^4.x | Unit + integration tests |
| ESLint | ^10.x | Linting (flat config) |
| `@typescript-eslint` | latest | TS-aware linting |
| Prettier | ^3.x | Formatting |
| tsx | ^4.x | TS script runner |
| release-it | ^20.x | Versioning + npm publish |
| `@release-it/conventional-changelog` | latest | Changelog automation |
| Snyk | n/a | Vulnerability scanning |

---

## 3. High-Level Architecture

### 3.1 Process Topology

```
+-----------------+        stdio         +-------------------+        stdio        +----------------+
|                 |  JSON-RPC frames     |                   |  JSON-RPC frames    |                |
|   MCP Client    | <==================> |     JanuScope     | <================> |  Target MCP    |
| (Claude/Cursor) |   (NDJSON lines)     |  (this project)   |   (NDJSON lines)   |   (child proc) |
|                 |                      |                   |                    |                |
+-----------------+                      +-------------------+                    +----------------+
                                                 |
                                                 v
                                         +---------------+
                                         |  Audit sink   |
                                         | (NDJSON file) |
                                         +---------------+
```

### 3.2 Message Flow

For every JSON-RPC message in either direction:

1. Frame decoder accumulates bytes and emits complete messages
2. Pipeline iterates overlays **in registration order**
3. Each overlay's `onClientMessage` / `onServerMessage` runs **sequentially** (awaited)
4. Any overlay may:
   - Forward the message (default)
   - Modify the message (e.g., redact, decorate)
   - Short-circuit and respond directly (e.g., block)
   - Inject additional messages
5. Final message is encoded and written to the opposite stdio stream

### 3.3 Source Layout

```
src/
├── index.ts              # Public library API (runOverlay, types)
├── cli.ts                # CLI dispatcher
├── config.ts             # YAML/JSON loader + Zod validation + env substitution
├── secrets.ts            # vault://, aws-sm://, 1pw:// resolvers
├── pipeline.ts           # Overlay orchestrator
├── rpc.ts                # JSON-RPC types, FrameDecoder, encodeFrame
├── quarantine.ts         # TOFU fingerprinting + approval store
├── lenses.ts             # Lens discovery + metadata parsing
├── probe.ts              # Target handshake + tools/list probe
├── telemetry.ts          # OpenTelemetry integration (lazy)
├── boot-summary.ts       # Stderr startup banner
├── overlays/
│   ├── _shared.ts        # Glob matching, tool extraction helpers
│   ├── audit.ts
│   ├── block.ts
│   ├── sqlGuard.ts
│   ├── redact.ts
│   ├── instructions.ts
│   ├── rateLimit.ts
│   ├── contextInjection.ts
│   ├── toolSurface.ts
│   └── db-schema/
│       ├── index.ts
│       ├── types.ts
│       ├── format.ts
│       └── drivers/
│           ├── postgres.ts
│           ├── mysql.ts
│           └── sqlite.ts
└── transport/
    └── stdio.ts          # Child-process spawn + stdin/stdout piping
```

---

## 4. Core Engine Components

### 4.1 JSON-RPC Layer (`rpc.ts`)

**Responsibilities**

- Define the JSON-RPC 2.0 message union: `Request | Notification | SuccessResponse | ErrorResponse`
- Streaming NDJSON decoder: `FrameDecoder` class that buffers partial input, emits complete messages on newline
- Encoder: `encodeFrame(msg)` → JSON-stringified message + `\n`
- Type guards: `isRequest`, `isNotification`, `isResponse`, `isSuccess`, `isErrorResponse`
- Error code constants (per JSON-RPC spec): `ParseError = -32700`, `InvalidRequest = -32600`, `MethodNotFound = -32601`, `InvalidParams = -32602`, `InternalError = -32603`, plus `ServerError` band `-32000` to `-32099`
- Factory: `makeErrorResponse(id, code, message, data?)`

**Edge cases to handle**

- Multi-byte UTF-8 split across chunks
- Empty lines (skip)
- Malformed JSON (log + drop, do not crash)
- Messages without `id` (notifications — no response expected)

### 4.2 Stdio Transport (`transport/stdio.ts`)

**Responsibilities**

- Spawn target MCP via `child_process.spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "inherit"] })`
- Wire two `FrameDecoder` instances:
  - One on `process.stdin` (client → target direction)
  - One on `child.stdout` (target → client direction)
- For each decoded frame, pass through the pipeline, then write to the opposite stream
- Graceful shutdown:
  - On client EOF → close target stdin, wait for exit
  - On target exit → flush, log, exit with same code
- Error handling: malformed frames logged but do not crash

### 4.3 Pipeline Orchestrator (`pipeline.ts`)

**Overlay interface**

```ts
interface Overlay {
  name: string;
  kind?: "gate" | "observer";  // gate fails closed; observer fails open
  setup?(ctx: OverlayContext): Promise<void>;
  teardown?(ctx: OverlayContext): Promise<void>;
  onClientMessage?(msg: JsonRpcMessage, ctx: OverlayContext): ClientMessageResult;
  onServerMessage?(msg: JsonRpcMessage, ctx: OverlayContext): ServerMessageResult;
}
```

**OverlayContext exposes**

- `log(level, msg, data?)` — stderr-prefixed logger
- `state` — per-overlay scratch storage
- `forward(msg)` — explicit forwarding API
- `inject(direction, msg)` — emit an extra message
- `respond(msg)` — short-circuit with a direct response
- Telemetry span handle

**Concurrency rules**

- Overlays run **sequentially** (not parallel) — deterministic ordering required for audit
- Each handler is awaited before the next runs
- Multiple in-flight requests across overlays run concurrently (one chain per request)

**Error semantics**

- `kind: "gate"` → if handler throws, return `-32603` InternalError to client; **do not forward**
- `kind: "observer"` → if handler throws, log and continue with unmodified message

### 4.4 Configuration Loader (`config.ts`)

**Two entry points**

- `loadConfig(path, env)` — synchronous; refuses configs containing async secret refs
- `loadConfigAsync(path, env)` — async; resolves `vault://`, `aws-sm://`, `1pw://` references

**Pipeline inside the loader**

1. Read file (YAML or JSON, autodetected by extension)
2. Parse to JS object
3. Substitute env vars (`${VAR}` and `$VAR`)
   - Missing → empty string + stderr warning (non-fatal)
   - Async refs detected here → resolve via `secrets.ts`
4. Validate with Zod schema (see Section 6)
5. Normalize: path expansion (`~/`, relative-to-config, absolute), default values
6. Return typed `OverlayConfig`

**Helper exports**

- `OverlayConfigSchema` (Zod)
- `validateConfig(input)`
- `substituteEnv(value, env, options)`
- `detectSecretRefs(value)`

### 4.5 Secrets Resolver (`secrets.ts`)

**Supported schemes**

| Scheme | Example | Backend |
|---|---|---|
| `vault://` | `${vault://secret/data/db#password}` | HashiCorp Vault |
| `aws-sm://` | `${aws-sm://arn:aws:secretsmanager:...#field}` | AWS Secrets Manager |
| `1pw://` | `${1pw://op://vault/item/field}` | 1Password CLI |

**API**

- `parseSecretRef(ref) → { scheme, path, field? }`
- `resolveAllSecretRefs(value) → string` (async; walks object, resolves all refs)
- All backend SDKs **lazy-loaded** — no overhead if unused

### 4.6 Quarantine / Fingerprinting (`quarantine.ts`)

**Concept:** Trust-On-First-Use. Two independent fingerprint layers:

| Layer | What It Hashes | Catches |
|---|---|---|
| **Static** | target command + block + sqlGuard + rateLimit + redact + classification | Operator config drift |
| **Live** | tools/list response (names, descriptions, inputSchemas, annotations) | Upstream tool poisoning |

**Storage:** `~/.januscope/approved.json`

**API**

- `computeFingerprint(config)` → object with per-component sub-hashes
- `computeFingerprintHash(config)` → SHA-256 string
- `checkQuarantine(config)` → `{ approved: bool, drift?: string[] }`
- `recordApproval(config)` → write entry
- `computeLiveToolsFingerprint(tools)` → SHA-256
- `checkLiveTools(approvalEntry, tools)` → `{ approved, drift? }`
- `recordLiveToolsApproval(approvalEntry, tools)`

**Activated by:** `firstRun: approve` in the lens config.

### 4.7 Target Probe (`probe.ts`)

**Purpose:** Spawn the target and run the MCP handshake to discover tools.

**Sequence**

1. Spawn target with same env/cwd/args as runtime
2. Send `initialize` request with client capabilities
3. Receive `initialize` response
4. Send `initialized` notification
5. Send `tools/list` request
6. Receive tools array
7. Send `shutdown` (if supported) and exit child

**Returns:** `{ tools: LiveTool[], serverInfo }`

**Timeout:** 90 seconds default (covers `mcp-remote` HTTP startup latency).

**Used by:** CLI `approve`, `validate-lenses --probe`, benchmarking.

### 4.8 Telemetry (`telemetry.ts`)

**Two modes**

- **NOOP_TRACER** — exported constant; branchless when telemetry not configured
- **createOtelTracer(config)** — lazily imports `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`; creates a real tracer with the configured endpoint, service name, and headers

**Spans emitted**

- One per `handleClientMessage` call
- One per `handleServerMessage` call
- One per overlay invocation (nested under the above)

**Attributes**

- `mcp.method`, `mcp.tool_name`, `januscope.overlay`, `januscope.classification`, `januscope.outcome`

### 4.9 Boot Summary (`boot-summary.ts`)

**Output channel:** stderr (must never write to stdout — that's the JSON-RPC channel).

**Suppression flags:** `JANUSCOPE_QUIET=1`, `JANUSCOPE_NO_BOOT_SUMMARY=1`.

**Rendered content**

- Version
- Target command (truncated to ~60 chars)
- List of active overlays + their key settings
- Audit sink path (if configured)
- Classification level (if set)

### 4.10 Lens Discovery (`lenses.ts`)

**Responsibilities**

- Walk `lenses/<category>/<name>/` directories
- Parse each lens's `config.yaml` and `README.md` (with YAML frontmatter)
- Return `Lens[]` with metadata, config, full README body, and `isStale` flag

**Helpers**

- `loadLenses(options)`
- `splitFrontmatter(text)` — extract YAML frontmatter from Markdown
- `findBundledLensesDir()` — resolve `lenses/` relative to entry point (works in dev + installed npm package)
- Constants: `LENS_CATEGORIES`, `LENS_STATUSES`, `STALE_THRESHOLD_MONTHS = 6`

---

## 5. The 9 Policy Overlays

> Each overlay is an independent module implementing the `Overlay` interface. Build them in the order listed (simplest first).

### 5.1 `audit` — NDJSON Compliance Logging

**Kind:** Observer (must never block flow).

**Config**

```yaml
audit:
  sink: ./audit.log         # file path | "stderr" | "stdout"
  logRawArgs: false         # default false — hash args instead
```

**Event types**

| Event | Trigger |
|---|---|
| `startup` | Pipeline initialized; includes sink path, version, lens name |
| `shutdown` | Pipeline closing; includes reason (client_eof, target_exit, error) |
| `tools/call ok` | Successful tool call; includes `args_hash`, optional `response_hash` |
| `tools/call error` | Tool call returned a JSON-RPC error |
| `tools/call timeout` | Request never received a matching response |
| `tools/call orphaned` | Response received without matching request |

**Identity fields** (optional, sourced from env)

- `JANUSCOPE_USER`
- `JANUSCOPE_TEAM`
- `JANUSCOPE_SESSION`

**Other fields**

- `classification` (from lens config)
- `lens_name`, `lens_version`
- `timestamp` (ISO 8601)
- `tool_name`
- `args_hash` (SHA-256, hex) — always present
- `args` (raw) — only when `logRawArgs: true`

**Write semantics:** async, fire-and-forget; write errors logged to stderr but never block the pipeline.

**JSON Schema:** ships as `schemas/audit-event.json` (JSON Schema draft 2020-12).

### 5.2 `block` — Tool-Name Filtering

**Kind:** Gate.

**Config**

```yaml
block:
  - admin_*
  - delete_user
  - reset_database
```

**Glob rules**

- `*` matches any chars except `_` separator (so `admin_*` matches `admin_delete` but **not** `namespace:admin_foo`)
- Exact match if no `*` present

**Behavior**

- `tools/list` responses: filter blocked tools out of the array
- `tools/call` requests with a blocked name: short-circuit with `-32601 MethodNotFound`
- Zero overhead when no rules configured

### 5.3 `sqlGuard` — SQL Mutation Prevention

**Kind:** Gate.

**Config**

```yaml
sqlGuard:
  tools: [query, execute_sql]
  sqlArg: sql              # default: "sql"
  readOnly: true
  mode: allowlist          # "allowlist" (default, recommended) | "denylist"
  extraWriteKeywords: []   # denylist mode only
  extraReadVerbs: []       # allowlist mode only
```

**Allowlist mode (default)**

Only statements whose leading verb is in this set are permitted: `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `DESC`, `VALUES`, `PRAGMA`, `TABLE`.

**Denylist mode (legacy)**

Keyword blacklist: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `MERGE`, `REPLACE`, `RENAME`, `COMMENT`, `LOCK`, `CALL`, `EXEC`, `EXECUTE`, `DO`, plus any in `extraWriteKeywords`.

**Pre-processing (anti-evasion)**

1. Strip SQL comments (`--`, `/* ... */`, nested)
2. Blank out string literals (`'...'`, `"..."`, `$$...$$`) — keep delimiters for length but blank content
3. Normalize whitespace
4. Split on `;` for multi-statement detection — all statements must be read-only

**Error response:** `-32602 InvalidParams` with descriptive message.

### 5.4 `redact` — PII Scrubbing

**Kind:** Observer.

**Config**

```yaml
redact:
  rules:
    - regex: '\b\d{3}-\d{2}-\d{4}\b'   # SSN-like
    - regex: '[\w.+-]+@[\w-]+\.[\w.-]+' # email
    - field: 'user.email'
    - field: 'rows.*.ssn'
    - field: 'rows.**.password'
  replacement: '[REDACTED]'
  applyTo: text                          # text | fields | all
```

**Rule types**

- `regex` — pattern applied to text content (case-insensitive by default)
- `field` — JSON path with wildcards:
  - `*` matches exactly one path segment
  - `**` matches any depth

**Apply modes**

| Mode | Behavior |
|---|---|
| `text` (default) | Regex on text blocks + field rules on JSON parsed out of text blocks |
| `fields` | Field rules only |
| `all` | Regex applied everywhere |

**Critical:** Deep-clone the response before mutating, so prior overlays (audit) still see the un-redacted data.

### 5.5 `instructions` — Tool Description Injection

**Kind:** Observer.

**Config**

```yaml
instructions:
  text: "All queries must be read-only. Aggregate before returning."
  position: prepend       # append (default) | prepend
```

Or shorthand: `instructions: "string..."` (defaults to `append`).

**Classification banner** — when lens has `classification: <level>`, automatically prepend:

| Level | Banner |
|---|---|
| `public` | `CLASSIFICATION: PUBLIC — no special handling required.` |
| `internal` | `CLASSIFICATION: INTERNAL — do not expose raw values to end users.` |
| `sensitive` | `CLASSIFICATION: SENSITIVE — PII, financial, or regulated data. Aggregate or anonymize.` |

Applied to every tool's `description` in `tools/list` responses.

### 5.6 `rateLimit` — Token Bucket

**Kind:** Gate.

**Config**

```yaml
rateLimit:
  - tool: query
    perMinute: 60
  - tool: admin_*
    perMinute: 5
```

**Algorithm**

- Per-rule (and per-tool within a glob) token bucket
- Refill rate: `perMinute / 60` tokens per second
- Bucket capacity: `max(perMinute, 1)` (allows fractional rates < 1/min)
- Tokens consumed when a `tools/call` matches the rule
- Empty bucket → reject with `-32000` (JSON-RPC server-error band; semantically equivalent to HTTP 429)

**Per-tool isolation:** A glob rule (`admin_*`) creates separate buckets per matched tool name, so a hot tool doesn't starve sibling tools sharing the rule.

### 5.7 `dbSchema` — DB Introspection + Schema Injection

**Kind:** Observer.

**Config**

```yaml
dbSchema:
  driver: postgres                # postgres | mysql | sqlite (auto-inferred from connectionString)
  connectionString: "postgres://..."
  tables: [users, orders]         # optional whitelist
  excludeTables: [pg_*]           # optional blacklist
  schemas: [public, app]          # Postgres only; default: ["public"]
  injectInto: [query, execute_sql] # default: [query, execute, execute_sql, search, pg_query, mysql_query, sql]
  format: markdown                # markdown (default) | ddl | compact
  includeComments: true           # default true
  refresh: startup                # startup (default) | never
```

**Workflow**

1. At pipeline `setup()`: connect to DB
2. Introspect: tables, columns, types, primary keys, foreign keys, indexes, constraints, comments
3. Format using selected format module
4. Cache formatted string in overlay state
5. On every `tools/list` response, inject the schema into each matching tool's description

**Format styles**

| Format | Example |
|---|---|
| `markdown` | Section per table, columns in a Markdown table |
| `ddl` | `CREATE TABLE` statements with all constraints |
| `compact` | `users(id PK, email UNIQUE, created_at)` one-liners |

**Failure mode:** Fails open. If DB unreachable at startup, log warning and skip injection; pipeline still works.

**Driver structure**

```
overlays/db-schema/
├── index.ts           # Overlay factory
├── types.ts           # Driver, SchemaSnapshot, IntrospectOptions interfaces
├── format.ts          # Format engines
└── drivers/
    ├── postgres.ts    # Uses pg
    ├── mysql.ts       # Uses mysql2
    └── sqlite.ts      # Uses better-sqlite3
```

### 5.8 `contextInjection` — Static Context Injection

**Kind:** Observer.

**Config**

```yaml
contextInjection:
  injectInto: [query, search]
  text: "Allowed status values: ACTIVE, PENDING, ARCHIVED"  # XOR with textFile
  textFile: ./project-glossary.md                            # XOR with text
  position: append   # append (default) | prepend
```

**Path resolution for `textFile`**

- Absolute paths used as-is
- Relative paths resolved against the config file's directory
- `~/` expanded to user home directory

**Use cases**

- Enum lists the LLM should respect
- Directory trees
- Project-specific glossaries
- Hardcoded scratchpad context

### 5.9 `toolSurface` — Live Drift Detection

**Kind:** Gate.

**Activation:** Only when `firstRun: approve` is set in the lens config.

**Workflow**

1. Watch the first `tools/list` response
2. Compute fingerprint over: tool names, descriptions, inputSchemas, annotations
3. Compare with stored approval entry (in `~/.januscope/approved.json`)
4. **First run:** record fingerprint, log "tools approved on first use"
5. **Drift detected:** rewrite the response to an error message explaining the drift; flag the session as "drift" so subsequent tools/list calls also fail
6. **Match:** pass through

**Sticky-failure semantics:** Once drift is detected in a session, it cannot be resolved mid-session. Operator must run `januscope approve --config <path>` to re-baseline.

---

## 6. Configuration Schema (Lens YAML)

### 6.1 Complete Reference

```yaml
# ===== Required =====
target:
  command: <string>           # binary or interpreter (e.g., "npx")
  args: [<string>]            # optional
  env: { KEY: VALUE }         # optional; merged with process.env
  cwd: <string>               # optional working directory

# ===== Optional =====
classification: public | internal | sensitive
firstRun: approve             # enables quarantine + toolSurface

# Tool blocking
block: [<name_or_glob>]

# Description decoration
instructions:                 # string OR object
  text: <string>
  position: append | prepend

# Audit logging
audit:
  sink: <path | "stderr" | "stdout">
  logRawArgs: <bool>          # default false

# DB schema injection
dbSchema:
  driver: postgres | mysql | sqlite    # auto-inferred from connectionString
  connectionString: <string>
  tables: [<string>]
  excludeTables: [<string>]
  schemas: [<string>]                  # Postgres only
  injectInto: [<tool_name>]
  format: markdown | ddl | compact
  includeComments: <bool>
  refresh: startup | never

# Static context injection
contextInjection:
  injectInto: [<tool_name>]            # required, at least one
  text: <string>                       # XOR with textFile
  textFile: <path>                     # XOR with text
  position: append | prepend

# PII redaction
redact:
  rules:
    - { regex: <pattern> }
    - { field: <path_with_wildcards> }
  replacement: <string>                # default "[REDACTED]"
  applyTo: text | fields | all

# Rate limiting
rateLimit:
  - { tool: <name_or_glob>, perMinute: <number> }

# SQL guarding
sqlGuard:
  tools: [<string>]
  sqlArg: <string>                     # default "sql"
  readOnly: <bool>                     # default true
  mode: allowlist | denylist
  extraWriteKeywords: [<string>]
  extraReadVerbs: [<string>]

# OpenTelemetry export
telemetry:
  otel:
    endpoint: <url>
    serviceName: <string>
    headers: { K: V }
```

### 6.2 Environment Variable Substitution

- `${VAR}` and `$VAR` syntax
- Substituted at config load time
- Missing var → empty string + stderr warning (non-fatal by design)
- Inside strings, JSON values, list elements — anywhere

### 6.3 Secret Backend References

Resolved only by `loadConfigAsync`:

- `${vault://path#field}`
- `${aws-sm://arn#field}`
- `${1pw://op://vault/item/field}`

---

## 7. Command-Line Interface

### 7.1 Primary Modes

| Invocation | Purpose |
|---|---|
| `januscope --config <path>` | Full lens-driven mode |
| `januscope --target "<cmd>" --block a,b --audit <path>` | Minimal mode (no config file needed) |
| `januscope --version` | Print version |
| `januscope --help` | Print help text |

### 7.2 Subcommands

| Command | Purpose |
|---|---|
| `januscope lenses list` | List all bundled lenses with status + category |
| `januscope lenses show <name>` | Print one lens's config.yaml + README |
| `januscope lenses search <query>` | Search lenses by name/tag/description |
| `januscope approve --config <path>` | Re-baseline quarantine + toolSurface fingerprints |

### 7.3 Behavior Details

- Exit code `0` on success
- Exit code `1` on config error
- Exit code `2` on bad invocation
- Stdio frames: stdin/stdout reserved for JSON-RPC; all logs to stderr
- Signals: SIGINT/SIGTERM → graceful shutdown, propagate to target

---

## 8. Lens Library

### 8.1 Lens Format

Each lens lives at `lenses/<category>/<name>/`:

```
lenses/databases/postgres-crystaldba/
├── config.yaml        # Full lens config
└── README.md          # Frontmatter + usage docs
```

### 8.2 README Frontmatter

```yaml
---
mcp: "Postgres MCP Pro"
mcpUrl: "https://github.com/crystaldba/postgres-mcp"
testedVersion: "0.3.1"
testedAt: "2025-11-01"
maintainer: "@giancarloerra"
category: databases               # databases | dev-tools | saas | infra | other
status: probed                    # probed | active | unverified | stale | archived
tags: [postgres, sql, readonly]
---
```

### 8.3 Status Definitions

| Status | Meaning |
|---|---|
| `probed` | Live-tested against target's tools/list on testedAt date |
| `active` | Maintained, documented, but not live-probed this cycle |
| `unverified` | Config parses, tool names match docs, no live test (no credentials) |
| `stale` | Not re-tested in >6 months (auto-flagged) |
| `archived` | Target MCP retired; kept for reference |

### 8.4 Bundled Lenses (20 total)

**Databases (11)**

1. `postgres-crystaldba` — Postgres MCP Pro (community)
2. `mysql-benborla29` — @benborla29/mcp-server-mysql
3. `mongodb-official` — MongoDB Inc.
4. `clickhouse-official` — ClickHouse Inc.
5. `redis-official` — Redis Inc.
6. `sqlite-panasenco` — panasenco/mcp-sqlite
7. `snowflake-labs` — Snowflake Inc.
8. `neon-cloud` — Neon (hosted Postgres)
9. `redshift` — AWS Redshift
10. `aurora-dsql` — AWS Aurora DSQL
11. `oracle-db-sqlcl` — Oracle Database

**Dev Tools (2)**

1. `github-official` — GitHub Inc.
2. `filesystem-mcp-official` — MCP reference server

**SaaS (7)**

1. `stripe-official` — Stripe Inc.
2. `notion-official` — Notion (remote via mcp-remote)
3. `atlassian-official` — Atlassian (remote)
4. `linear-remote` — Linear Inc. (remote)
5. `supabase-cloud` — Supabase (hosted)
6. `supabase-selfhost` — Supabase (self-hosted)
7. `mssql-azure-dab` — Microsoft SQL Server / Azure SQL

### 8.5 Lens Quality Bar

- Valid JanuScope config (parses, schema-validates)
- Complete frontmatter
- Credits target MCP (link to repo)
- Secrets via environment variables only (no hardcoded credentials)
- Sensible defaults (usually read-only)
- Defence-in-depth: instructions + (block or sqlGuard) + redact where applicable
- Provides real value over bare MCP (not a no-op pass-through)

### 8.6 Template Lens

`lenses/_template/` — copy-paste starter for new lenses, with all sections commented + filled with placeholders.

---

## 9. Security & Trust Model

### 9.1 Defence-in-Depth Layering

For high-assurance lenses controlling sensitive data:

| Layer | Mechanism | Purpose |
|---|---|---|
| 1. Intent | `instructions` overlay | Shape the LLM's plan before it forms a tool call |
| 2. Proxy gate | `block` + `sqlGuard` + `rateLimit` | Refuse the call before the target sees it |
| 3. Output | `redact` overlay | Scrub PII from responses before the model reads them |
| 4. Backstop | Read-only DB credential | Last-resort defence at the data source |

Every layer is independent — if one fails, the others still hold.

### 9.2 Fail-Closed vs Fail-Open

| Overlay Type | On Error |
|---|---|
| Gate (`block`, `sqlGuard`, `rateLimit`, `toolSurface`) | Return `-32603` to client; **do not forward** |
| Observer (`audit`, `redact`, `instructions`, `dbSchema`, `contextInjection`) | Log warning; continue with unmodified message |

### 9.3 Quarantine (TOFU)

Two-layer fingerprint comparison on every run, when `firstRun: approve` is set:

- **Static layer** catches: edited block list, changed SQL guard config, added/removed redact rules, changed target command
- **Live layer** catches: upstream MCP modified its tool surface (poisoning, surprise updates)

Approval store: `~/.januscope/approved.json`, structured per-config.

### 9.4 Credential Handling

- All credentials must come from env vars or secret backends — **never** in config files
- Audit `args` always hashed by default (`logRawArgs: false`); raw args only when explicitly opted in
- Audit sink permissions are the operator's responsibility (file should be 0600 in production)

### 9.5 Threat Model (Documented in SECURITY.md)

| Threat | Mitigation |
|---|---|
| Compromised target MCP | toolSurface live fingerprint detection |
| Operator config drift | static quarantine fingerprint |
| LLM-initiated destructive query | sqlGuard + block + rateLimit |
| PII leaking to LLM context | redact overlay |
| No incident audit trail | audit overlay (NDJSON, SIEM-ready) |
| Schema discovery round-trips | dbSchema pre-injection |
| Stolen credentials in config | secret backend references, env-var-only |

---

## 10. Observability & Telemetry

### 10.1 Audit NDJSON

- One JSON object per line, terminated with `\n`
- Schema in `schemas/audit-event.json` (JSON Schema 2020-12)
- Six event types (see Section 5.1)
- SIEM-friendly format
- Async writes; failures don't block pipeline

### 10.2 OpenTelemetry (Optional)

When `telemetry.otel.endpoint` is set:

- Spans created per client message, per server message, per overlay
- Attributes: `mcp.method`, `mcp.tool_name`, `januscope.overlay`, `januscope.classification`, `januscope.outcome`
- Exporter: OTLP HTTP
- Lazy-loaded SDK (zero overhead when disabled)

### 10.3 Boot Summary

- Stderr-only banner at startup
- Lists active overlays + key settings
- Suppressible via `JANUSCOPE_QUIET` / `JANUSCOPE_NO_BOOT_SUMMARY`

### 10.4 Per-Overlay Logging

`OverlayContext.log(level, msg, data?)` emits prefixed stderr lines:

```
[januscope:audit] info Logged tools/call ok for "query" (args_hash=abc...)
[januscope:sqlGuard] warn Rejected write statement in "execute_sql"
```

---

## 11. Testing Strategy

### 11.1 Framework

**Vitest** (^4.x) — fast, ESM-native, parallel by default.

### 11.2 Test Categories

#### Per-Overlay Unit Tests

| File | Coverage |
|---|---|
| `test/overlays/audit.test.ts` | Event structure, identity capture, hashing |
| `test/overlays/block.test.ts` | Glob matching, tool filtering, short-circuit |
| `test/overlays/sqlGuard.test.ts` | Allowlist/denylist modes, comment stripping |
| `test/overlays/sqlGuard-embedded-writes.test.ts` | Evasion attempts (comments, string-literal tricks) |
| `test/overlays/sqlGuard-postgres-functions.test.ts` | Dialect edge cases |
| `test/overlays/sqlGuard-udf-limits.test.ts` | UDF parsing limits |
| `test/overlays/redact.test.ts` | Regex + field patterns, deep cloning, modes |
| `test/overlays/rateLimit.test.ts` | Bucket refill, fractional rates, breach response |
| `test/overlays/instructions.test.ts` | Description splicing, classification banners, position |
| `test/overlays/db-schema.test.ts` | Introspection, all three formats |
| `test/overlays/contextInjection.test.ts` | Text + textFile resolution, path expansion |
| `test/overlays/toolSurface.test.ts` | Fingerprint, drift detection, sticky failures |

#### Core Module Tests

| File | Coverage |
|---|---|
| `test/pipeline.test.ts` | Overlay ordering, concurrent messages, error propagation |
| `test/config.test.ts` | YAML/JSON parsing, validation, env substitution |
| `test/secrets.test.ts` | Secret ref parsing, backend resolution |
| `test/rpc.test.ts` | FrameDecoder edge cases, encoder, type guards |
| `test/quarantine.test.ts` | Fingerprint computation, TOFU flow, drift |
| `test/lenses.test.ts` | Lens discovery, frontmatter parsing, stale detection |
| `test/probe.test.ts` | Target probing, handshake sequence |
| `test/cli.test.ts` | CLI parsing, subcommand routing |
| `test/boot-summary.test.ts` | Rendering, truncation, env-flag suppression |
| `test/telemetry.test.ts` | OTel span tracking, no-op tracer |

#### Integration Tests (Fake MCP child)

| File | Coverage |
|---|---|
| `test/integration/runOverlay.test.ts` | End-to-end with fake MCP |
| `test/integration/db-schema-integration.test.ts` | DB introspection (in-memory SQLite) |
| `test/integration/redact-integration.test.ts` | Redaction on full payloads |

#### CLI / Tooling Tests

| File | Coverage |
|---|---|
| `test/cli-config-resolver.test.ts` | Config file resolution, env expansion |
| `test/lens-env-transparency.test.ts` | Env vars pass through to target |
| `test/validate-lenses.test.ts` | Lens validation script |

### 11.3 Fixtures

`test/fixtures/` contains:

- Sample lens configs
- Fake MCP server scripts (Node scripts emitting canned JSON-RPC)
- Test data (sample PII payloads, SQL strings, schema dumps)

### 11.4 No External Dependencies for Tests

- `dbSchema` overlay tested only against in-memory SQLite — no real DB required
- All target probing tested via fake child processes — no network required
- All tests run in CI on every PR

---

## 12. Tooling, Build & Release

### 12.1 NPM Scripts

| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc -p tsconfig.build.json` | Compile to `dist/` |
| `test` | `vitest run` | One-shot test run |
| `test:watch` | `vitest --watch` | Watch mode |
| `typecheck` | `tsc --noEmit` | Type check without emit |
| `lint` | `eslint src test scripts` | Lint |
| `format` | `prettier --write .` | Format all files |
| `format:check` | `prettier --check .` | Check formatting |
| `validate:lenses` | `tsx scripts/validate-lenses.ts` | Validate bundled lenses |
| `bench:overhead` | `tsx scripts/bench-overhead.ts` | Pipeline benchmark |
| `release` | `release-it` | Cut a release |
| `release:dry` | `release-it --dry-run` | Dry-run release |
| `prepublishOnly` | Run typecheck + lint + format:check + test + validate:lenses + build | Pre-publish gate |

### 12.2 Lens Validation Script (`scripts/validate-lenses.ts`)

**Modes**

| Flag | Behavior |
|---|---|
| (default) | Structural validation — config parses, frontmatter valid |
| `--strict` | + fail if any lens is stale (>6 months) |
| `--probe` | + dynamically spawn each target, run `tools/list`, verify tool names match docs |

**Exit codes**

- `0` — all lenses pass
- `1` — validation failure (one or more lenses invalid)
- `2` — bad invocation (unknown flag, missing arg)

### 12.3 Benchmark Script (`scripts/bench-overhead.ts`)

- Spawns a fake MCP
- Runs N tool calls through the full pipeline
- Measures: median latency, p95 latency, memory delta, throughput (calls/sec)
- Compares against a no-overlay baseline
- Used to catch performance regressions across releases

### 12.4 Configuration Files

| File | Purpose |
|---|---|
| `tsconfig.json` | TS config (app + tests) |
| `tsconfig.build.json` | TS config (build only — excludes tests) |
| `vitest.config.ts` | Vitest setup |
| `eslint.config.mjs` | Flat ESLint config |
| `.prettierrc.json` | Prettier settings (double quotes, 2-space indent) |
| `.prettierignore` | Excludes node_modules, dist |
| `.snyk` | Snyk vulnerability policy |
| `.release-it.json` | Release config (npm publish, GitHub release, tag) |
| `.github/workflows/` | CI: test, lint, typecheck, validate-lenses, security scan |

### 12.5 Release Process

1. `release-it` triggered manually or via CI tag push
2. Conventional-commits parsed to generate `CHANGELOG.md` entry
3. Version bumped in `package.json`
4. `prepublishOnly` runs full validation gate
5. `npm publish` to registry
6. GitHub release created with changelog body
7. Git tag pushed

---

## 13. Distribution & Packaging

### 13.1 Files Included in NPM Package

- `dist/**/*` — compiled JS + .d.ts
- `lenses/**/*` — bundled lens library
- `schemas/**/*` — JSON schemas
- `README.md`, `LICENSE`, `LICENSE-COMMERCIAL`, `CHANGELOG.md`
- `server.json`, `mcp.json`, `glama.json`

### 13.2 Server Metadata Files

#### `server.json` (MCP server registry)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/...",
  "name": "io.github.<org>/januscope",
  "description": "...",
  "repository": "https://github.com/...",
  "version": "...",
  "packages": [{
    "registryType": "npm",
    "identifier": "januscope",
    "transport": { "type": "stdio" },
    "runtimeArguments": [
      { "name": "--config", "required": true, "type": "filepath" }
    ],
    "environmentVariables": [
      { "name": "JANUSCOPE_USER", "required": false, "secret": false },
      { "name": "JANUSCOPE_TEAM", "required": false, "secret": false },
      { "name": "JANUSCOPE_SESSION", "required": false, "secret": false }
    ]
  }]
}
```

#### `mcp.json` (Client config snippet)

Minimal example showing typical invocation for users to copy-paste into their MCP client config.

#### `glama.json` (Glama.ai directory)

Maintainer + metadata for the Glama MCP directory listing.

### 13.3 Repo Hygiene Documents

| File | Purpose |
|---|---|
| `LICENSE` | AGPL-3.0 |
| `LICENSE-COMMERCIAL` | Commercial alternative for AGPL-blocked orgs |
| `CLA.md` | Contributor License Agreement |
| `THIRD-PARTY-LICENSES` | Third-party dep license notices |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `CONTRIBUTING.md` | Code style, testing, lens submission process |
| `SECURITY.md` | Threat model, defence-in-depth, disclosure policy |
| `SUPPORT.md` | Community channels, sponsorship |
| `CHANGELOG.md` | Conventional-commits-driven version history |
| `README.md` | Quickstart + benchmarks + full config reference |
| `ARCHITECTURE.md` | System design, MCP protocol, security model |

---

## 14. Design Principles to Preserve

These are the high-leverage decisions that give the project its character. Any rebuild should consciously preserve them.

### 14.1 Defence in Depth

Layer policy at every chokepoint — intent (instructions), gate (block, sqlGuard), output (redact), credential (DB role). Independent layers, no single point of failure.

### 14.2 Push, Not Pull

Inject context (DB schema, glossaries, enums) into tool descriptions **once at startup**, so the LLM forms correct queries on the first try instead of discovering via round-trips. Measured ~84% token reduction vs. bare MCP for typical sessions.

### 14.3 Short-Lived Process Model

No daemon, no ports, no shared state. Spawn per client connection, die when client closes. Operationally simple, secure by default, no surface for remote exploitation.

### 14.4 Sequential Pipeline

Overlays run in registration order; audit always sees pre-redact, pre-rewrite payloads. Deterministic semantics matter more than parallelism for a policy proxy.

### 14.5 Fail-Closed Gates, Fail-Open Observers

Security overlays refuse on internal error. Cosmetic overlays log and continue. The audit log always captures the attempt either way.

### 14.6 TOFU + Live Drift Detection

Two independent fingerprints catch both operator config changes and upstream tool poisoning. Both require explicit operator approval to roll forward.

### 14.7 Lazy-Loaded Peer Deps

DB drivers, OTel SDKs, secret backends — none loaded unless actually used. No runtime overhead, no surprise install footprint.

### 14.8 Stdio-Native + Remote Bridge Support

Target spawned as child process for local stdio MCPs. Remote MCPs proxied via `mcp-remote` (also a child). Single transport model, two deployment shapes.

---

## 15. Suggested Build Order

A pragmatic 13-step path that delivers working software at each milestone:

1. **Foundation**
   - `src/rpc.ts` — JSON-RPC types + FrameDecoder + encoder + tests
   - `src/transport/stdio.ts` — child-process spawn + stdin/stdout piping
   - `src/pipeline.ts` — minimal pipeline (no overlays yet, just pass-through)
   - Minimal CLI accepting `--config`

2. **Validate end-to-end**
   - Get a no-op pass-through working against a real MCP server (e.g., filesystem reference server)
   - Confirm bidirectional flow, clean shutdown

3. **First overlay: `block`**
   - Simplest gate
   - Gives you a real, useful policy proxy on day one
   - Cement the `Overlay` interface

4. **Config layer**
   - `src/config.ts` with Zod + YAML loader
   - Env substitution
   - Path expansion

5. **Observability overlays**
   - `audit` — NDJSON sink, identity capture
   - `instructions` — description decoration

6. **Security gates**
   - `sqlGuard` — allowlist mode first; denylist mode + extras after
   - `rateLimit` — per-tool token buckets

7. **Output processing**
   - `redact` — regex first; field patterns + apply modes after

8. **Advanced injection**
   - `contextInjection` — text + textFile
   - `dbSchema` — one driver first (SQLite is easiest), then Postgres, then MySQL

9. **Trust system**
   - `quarantine` — static fingerprint
   - `toolSurface` — live fingerprint
   - CLI `approve` subcommand

10. **Secrets resolution**
    - `secrets.ts` — start with env-var-only; add Vault/AWS-SM/1Password progressively

11. **Telemetry**
    - `telemetry.ts` — NOOP_TRACER first; OTel integration as add-on

12. **Tooling**
    - `boot-summary.ts`
    - `lenses.ts` discovery
    - `probe.ts`
    - `scripts/validate-lenses.ts`
    - `scripts/bench-overhead.ts`
    - Release pipeline

13. **Lens library**
    - Start with 2-3 well-tested lenses (postgres + github + filesystem)
    - Expand over time as you encounter real MCPs

---

## 16. Effort Estimate

Rough engineering estimate for a single experienced TypeScript engineer:

| Phase | Duration |
|---|---|
| Phase 1 — Foundation (steps 1-3) | 3-5 days |
| Phase 2 — Config + observability (steps 4-5) | 2-3 days |
| Phase 3 — Security overlays (steps 6-7) | 4-6 days |
| Phase 4 — Advanced injection (step 8) | 3-5 days (db drivers add up) |
| Phase 5 — Trust system (step 9) | 2-3 days |
| Phase 6 — Secrets + telemetry (steps 10-11) | 2-3 days |
| Phase 7 — Tooling (step 12) | 3-5 days |
| Phase 8 — Lens library + docs (step 13) | 3-5 days (per ~5 lenses) |
| Phase 9 — Hardening, full test coverage, polish | 5-7 days |
| **Total** | **~5-7 weeks** for a feature-complete rebuild |

This excludes:

- Maintaining 20 lenses long-term
- Community contribution review
- Security audits

---

## 17. Glossary

| Term | Definition |
|---|---|
| **MCP** | Model Context Protocol — a JSON-RPC-based standard for exposing tools to LLMs (Anthropic). |
| **MCP server** | A process exposing tools via the MCP protocol over stdio or HTTP. |
| **MCP client** | An AI application (Claude, Cursor, etc.) that talks to MCP servers. |
| **Tool** | A named, schema-described function exposed by an MCP server (e.g., `execute_sql`). |
| **Lens** | A JanuScope policy config — a YAML file wrapping one MCP server with overlays. |
| **Overlay** | A single policy module in the pipeline (block, audit, redact, etc.). |
| **Gate overlay** | An overlay that can refuse a message; fails closed on internal error. |
| **Observer overlay** | An overlay that can only observe or modify; fails open on internal error. |
| **TOFU** | Trust On First Use — record the initial fingerprint, alert on subsequent changes. |
| **Quarantine** | Static config-fingerprint trust system. |
| **Tool surface** | The set of tools an MCP server exposes (names + descriptions + schemas). |
| **mcp-remote** | Third-party stdio↔HTTP bridge used to wrap remote (hosted) MCPs as a child process. |
| **NDJSON** | Newline-delimited JSON — one JSON object per line. |
| **Defence in depth** | Independent layers of policy so no single failure compromises the system. |
| **Classification** | Lens-level label (`public` / `internal` / `sensitive`) that drives audit + banner behavior. |

---

## Appendix A — File-by-File Build Checklist

Reproduce this list as you go; tick off as you complete each file.

```
[ ] src/rpc.ts
[ ] src/transport/stdio.ts
[ ] src/pipeline.ts
[ ] src/index.ts (public API)
[ ] src/cli.ts
[ ] src/config.ts
[ ] src/secrets.ts
[ ] src/quarantine.ts
[ ] src/lenses.ts
[ ] src/probe.ts
[ ] src/telemetry.ts
[ ] src/boot-summary.ts
[ ] src/overlays/_shared.ts
[ ] src/overlays/audit.ts
[ ] src/overlays/block.ts
[ ] src/overlays/sqlGuard.ts
[ ] src/overlays/redact.ts
[ ] src/overlays/instructions.ts
[ ] src/overlays/rateLimit.ts
[ ] src/overlays/contextInjection.ts
[ ] src/overlays/toolSurface.ts
[ ] src/overlays/db-schema/index.ts
[ ] src/overlays/db-schema/types.ts
[ ] src/overlays/db-schema/format.ts
[ ] src/overlays/db-schema/drivers/postgres.ts
[ ] src/overlays/db-schema/drivers/mysql.ts
[ ] src/overlays/db-schema/drivers/sqlite.ts
[ ] schemas/audit-event.json
[ ] scripts/validate-lenses.ts
[ ] scripts/bench-overhead.ts
[ ] tsconfig.json + tsconfig.build.json
[ ] vitest.config.ts
[ ] eslint.config.mjs
[ ] .prettierrc.json + .prettierignore
[ ] .release-it.json
[ ] package.json (with all scripts)
[ ] Tests for every module above (mirror in test/)
[ ] Lens template + 3 starter lenses
[ ] README.md + ARCHITECTURE.md + SECURITY.md + CONTRIBUTING.md
[ ] server.json + mcp.json + glama.json
[ ] .github/workflows/{ci,release,security}.yml
```

---

*End of scope document.*
