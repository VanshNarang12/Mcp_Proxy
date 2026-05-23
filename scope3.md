# JanuScope — Detailed Functional Requirements Specification (FRS)

> **Purpose of this document.** This is the build-ready functional requirements specification for JanuScope. It sits between the engineering scope (`SCOPE.md`) and the stakeholder scope (`scope2.md`): every behavior the system must exhibit is captured as a numbered, testable requirement — what the system shall do, with what inputs, producing what outputs, under what error conditions. It is implementation-agnostic enough to be assigned to any engineer, but precise enough that conformance can be measured. Each requirement is uniquely identified (e.g., `FR-AUDIT-007`) so it can be traced to design, code, and tests.

---

## Table of Contents

1. [Document Conventions](#1-document-conventions)
2. [System Context](#2-system-context)
3. [Actors & Personas](#3-actors--personas)
4. [Use Cases (UC)](#4-use-cases-uc)
5. [Global Functional Requirements](#5-global-functional-requirements)
6. [Subsystem: JSON-RPC Layer (FR-RPC)](#6-subsystem-json-rpc-layer-fr-rpc)
7. [Subsystem: Stdio Transport (FR-TRANS)](#7-subsystem-stdio-transport-fr-trans)
8. [Subsystem: Pipeline Orchestrator (FR-PIPE)](#8-subsystem-pipeline-orchestrator-fr-pipe)
9. [Subsystem: Configuration Loader (FR-CFG)](#9-subsystem-configuration-loader-fr-cfg)
10. [Subsystem: Secret Resolver (FR-SEC)](#10-subsystem-secret-resolver-fr-sec)
11. [Subsystem: Quarantine & Trust (FR-QUAR)](#11-subsystem-quarantine--trust-fr-quar)
12. [Subsystem: Target Probe (FR-PROBE)](#12-subsystem-target-probe-fr-probe)
13. [Subsystem: Telemetry (FR-TEL)](#13-subsystem-telemetry-fr-tel)
14. [Subsystem: Boot Summary (FR-BOOT)](#14-subsystem-boot-summary-fr-boot)
15. [Subsystem: Lens Discovery (FR-LENS)](#15-subsystem-lens-discovery-fr-lens)
16. [Overlay: Audit (FR-AUDIT)](#16-overlay-audit-fr-audit)
17. [Overlay: Block (FR-BLOCK)](#17-overlay-block-fr-block)
18. [Overlay: SQL Guard (FR-SQL)](#18-overlay-sql-guard-fr-sql)
19. [Overlay: Redact (FR-RDCT)](#19-overlay-redact-fr-rdct)
20. [Overlay: Instructions (FR-INST)](#20-overlay-instructions-fr-inst)
21. [Overlay: Rate Limit (FR-RATE)](#21-overlay-rate-limit-fr-rate)
22. [Overlay: DB Schema Injection (FR-SCHEMA)](#22-overlay-db-schema-injection-fr-schema)
23. [Overlay: Context Injection (FR-CTX)](#23-overlay-context-injection-fr-ctx)
24. [Overlay: Tool Surface Drift (FR-DRIFT)](#24-overlay-tool-surface-drift-fr-drift)
25. [Subsystem: Command-Line Interface (FR-CLI)](#25-subsystem-command-line-interface-fr-cli)
26. [Subsystem: Lens Validation Tool (FR-VAL)](#26-subsystem-lens-validation-tool-fr-val)
27. [Subsystem: Benchmark Tool (FR-BENCH)](#27-subsystem-benchmark-tool-fr-bench)
28. [Cross-Cutting: Logging (FR-LOG)](#28-cross-cutting-logging-fr-log)
29. [Cross-Cutting: Error Handling (FR-ERR)](#29-cross-cutting-error-handling-fr-err)
30. [Non-Functional Requirements (NFR)](#30-non-functional-requirements-nfr)
31. [Data Models](#31-data-models)
32. [Acceptance Criteria](#32-acceptance-criteria)
33. [Traceability Matrix](#33-traceability-matrix)
34. [Open Questions & Assumptions](#34-open-questions--assumptions)

---

## 1. Document Conventions

### 1.1 Requirement IDs

Each requirement is identified as `FR-<AREA>-<NNN>`. Areas:

| Prefix | Subsystem |
|---|---|
| `FR-G` | Global / system-wide |
| `FR-RPC` | JSON-RPC framing & types |
| `FR-TRANS` | Stdio transport |
| `FR-PIPE` | Pipeline orchestrator |
| `FR-CFG` | Configuration loader |
| `FR-SEC` | Secret resolver |
| `FR-QUAR` | Quarantine / TOFU |
| `FR-PROBE` | Target probe |
| `FR-TEL` | Telemetry |
| `FR-BOOT` | Boot summary |
| `FR-LENS` | Lens discovery |
| `FR-AUDIT` | Audit overlay |
| `FR-BLOCK` | Block overlay |
| `FR-SQL` | SQL guard overlay |
| `FR-RDCT` | Redact overlay |
| `FR-INST` | Instructions overlay |
| `FR-RATE` | Rate limit overlay |
| `FR-SCHEMA` | DB schema overlay |
| `FR-CTX` | Context injection overlay |
| `FR-DRIFT` | Tool surface overlay |
| `FR-CLI` | Command-line interface |
| `FR-VAL` | Lens validation tool |
| `FR-BENCH` | Benchmark tool |
| `FR-LOG` | Logging |
| `FR-ERR` | Error handling |
| `NFR` | Non-functional |

### 1.2 Keywords

- **MUST / SHALL** — mandatory; conformance failure if not implemented.
- **SHOULD** — strongly recommended; deviation requires written justification.
- **MAY** — optional; permitted but not required.
- **MUST NOT** — prohibited.

### 1.3 Status

Each requirement carries an implicit status: **MVP** unless explicitly marked `[POST-MVP]` or `[STRETCH]`.

### 1.4 Source Traceability

Where helpful, requirements reference their origin in the upstream scopes via tags like `[scope2: §6.1]` or `[SCOPE: §5.3]`.

---

## 2. System Context

### 2.1 System Boundary

JanuScope is a single command-line program that runs locally on the operator's machine. It:

- Reads JSON-RPC 2.0 messages from `stdin`.
- Writes JSON-RPC 2.0 messages to `stdout`.
- Spawns and supervises one target MCP server as a child process.
- Reads/writes configuration files from the local filesystem.
- Optionally writes audit records to a local file (or `stderr`/`stdout` of the operator's choosing).
- Optionally fetches secrets from external secret backends (Vault, AWS Secrets Manager, 1Password) at startup.
- Optionally emits telemetry over OTLP/HTTP to a user-configured endpoint.

It does **not** run as a daemon, expose network ports, or maintain shared state across invocations.

### 2.2 External Interfaces

| Interface | Protocol | Direction | Required |
|---|---|---|---|
| MCP client (upstream) | JSON-RPC 2.0 over NDJSON via stdio | Bidirectional | Yes |
| Target MCP server (downstream) | JSON-RPC 2.0 over NDJSON via stdio | Bidirectional | Yes |
| Configuration file | YAML / JSON | Read | Yes (in lens mode) |
| Audit sink | NDJSON file or stream | Write | Optional |
| Approval store | JSON file at `~/.januscope/approved.json` | Read/Write | Optional |
| Secret backends | Vault HTTP API, AWS Secrets Manager, `op` CLI | Read | Optional |
| Telemetry collector | OTLP/HTTP | Write | Optional |
| Database (for schema overlay) | Native client (pg, mysql2, better-sqlite3) | Read | Optional |

### 2.3 In Scope vs. Out of Scope

In scope: every component listed in `scope2.md §5` (40 components) and every module listed in `SCOPE.md §3.3`.

Out of scope (carried forward from `scope2.md §13`): hosted gateway, GUI, prompt-injection scanning, MCP server reimplementation, real-time alerting, IAM, audit log encryption at rest.

---

## 3. Actors & Personas

| ID | Actor | Description |
|---|---|---|
| A1 | **Operator** | Human running JanuScope locally; configures the lens, starts the process. |
| A2 | **MCP Client** | Software process (Claude Desktop, Cursor, etc.) connecting to JanuScope's stdio. |
| A3 | **Target MCP Server** | Software process (local binary, `npx` package, `mcp-remote` bridge) spawned by JanuScope. |
| A4 | **Compliance Officer** | Reads audit logs out-of-band; never interacts with the running process. |
| A5 | **Platform Engineer** | Consumes telemetry; rolls out lenses across many operators. |
| A6 | **Lens Maintainer** | Authors and maintains entries in the lens library. |

---

## 4. Use Cases (UC)

### UC-1 — First-time launch with a new lens

**Primary actor:** Operator (A1).
**Preconditions:** Operator has a valid YAML lens and the target MCP installed.
**Main flow:**
1. Operator invokes `januscope --config ./mylens.yaml`.
2. System loads config (FR-CFG-001..), validates schema, resolves env vars.
3. If `firstRun: approve` is set, system computes static fingerprint and writes to approval store (FR-QUAR-005).
4. System spawns target MCP (FR-TRANS-001).
5. System prints boot summary to stderr (FR-BOOT-001).
6. System enters message loop (FR-PIPE-001).
**Postcondition:** AI client can talk to target MCP through JanuScope; audit log accumulates.

### UC-2 — Subsequent launch with unchanged config

**Main flow:** As UC-1, but at step 3 the system verifies fingerprint matches the approval store and proceeds silently. If a mismatch is detected, the system refuses to start (FR-QUAR-010).

### UC-3 — Lens drift detected mid-session

**Trigger:** Target MCP returns a `tools/list` response whose fingerprint differs from the approved baseline.
**Main flow:** Tool surface overlay (FR-DRIFT-004) rewrites the response into an error and flags the session as drifted; all subsequent `tools/list` responses are also failed.
**Recovery:** Operator runs `januscope approve --config ./mylens.yaml` (FR-CLI-014) to re-baseline.

### UC-4 — AI client attempts a blocked tool

**Trigger:** Client sends `tools/call` with a tool name matching a `block` rule.
**Main flow:** Block overlay short-circuits with `-32601 MethodNotFound` (FR-BLOCK-004). Audit overlay records the attempt with `outcome: error`.

### UC-5 — AI client issues a write SQL via an allowed tool

**Trigger:** Client sends `tools/call` to a SQL-guarded tool with a SQL string containing `UPDATE`.
**Main flow:** SQL guard parses and rejects with `-32602 InvalidParams` (FR-SQL-009). Audit records the rejected call.

### UC-6 — Operator browses the lens library

**Main flow:** Operator runs `januscope lenses list` (FR-CLI-009), then `januscope lenses show postgres-crystaldba` (FR-CLI-010) to inspect a candidate lens.

### UC-7 — Secret rotated in Vault

**Trigger:** A credential referenced via `${vault://...}` is rotated.
**Main flow:** On next launch, `loadConfigAsync` (FR-CFG-009) fetches the new value transparently; no config edit required.

### UC-8 — Target MCP exits unexpectedly

**Main flow:** Transport detects child exit (FR-TRANS-006), pipeline emits `shutdown` audit event with `reason: target_exit`, JanuScope exits with the child's exit code.

### UC-9 — Validation in CI

**Main flow:** CI runs `npm run validate:lenses --strict` (FR-VAL-005). Tool exits non-zero if any bundled lens fails structural or staleness checks.

### UC-10 — Operator wants minimal usage without a config file

**Main flow:** Operator runs `januscope --target "npx -y mcp-server-foo" --block "admin_*" --audit ./audit.log` (FR-CLI-005). System constructs an in-memory lens config equivalent to a YAML file with those fields.

---

## 5. Global Functional Requirements

| ID | Requirement |
|---|---|
| **FR-G-001** | The system MUST be invocable from a shell as a single executable named `januscope`. |
| **FR-G-002** | The system MUST treat `stdin` and `stdout` as exclusive JSON-RPC channels: no logs, banners, or auxiliary output SHALL be emitted on those streams. |
| **FR-G-003** | All human-readable diagnostic output (logs, banners, errors) MUST go to `stderr`. |
| **FR-G-004** | The system MUST exit with code `0` on a normal shutdown initiated by either party closing its stream. |
| **FR-G-005** | The system MUST exit with code `1` on configuration errors (file not found, invalid YAML, schema validation failure, target spawn failure). |
| **FR-G-006** | The system MUST exit with code `2` on bad CLI invocation (unknown flag, missing required argument). |
| **FR-G-007** | The system MUST propagate `SIGINT` and `SIGTERM` to the target child process, then exit cleanly with the appropriate code. |
| **FR-G-008** | The system MUST NOT make any network connection that the operator did not explicitly configure (no auto-update, no telemetry-by-default, no phone-home). |
| **FR-G-009** | The system MUST run on Node.js ≥ 20.0.0 and MUST refuse to start on lower versions with a clear error message. |
| **FR-G-010** | The system MUST be redistributable as a single npm package with all bundled lenses and JSON schemas included. |
| **FR-G-011** | The system MUST function on macOS, Linux, and Windows (subject to Node.js cross-platform behavior). |

---

## 6. Subsystem: JSON-RPC Layer (FR-RPC)

**Module:** `src/rpc.ts`

### 6.1 Message Types

| ID | Requirement |
|---|---|
| **FR-RPC-001** | The system MUST recognize four JSON-RPC 2.0 message kinds: Request (has `id` + `method`), Notification (has `method`, no `id`), Success Response (has `id` + `result`), Error Response (has `id` + `error`). |
| **FR-RPC-002** | The system MUST expose type guards: `isRequest`, `isNotification`, `isResponse`, `isSuccess`, `isErrorResponse`. |
| **FR-RPC-003** | The system MUST define JSON-RPC error code constants: `ParseError = -32700`, `InvalidRequest = -32600`, `MethodNotFound = -32601`, `InvalidParams = -32602`, `InternalError = -32603`, and a `ServerError` band of `-32000` to `-32099`. |
| **FR-RPC-004** | The system MUST provide a factory function `makeErrorResponse(id, code, message, data?)` returning a well-formed Error Response object. |

### 6.2 Frame Decoder

| ID | Requirement |
|---|---|
| **FR-RPC-010** | The decoder MUST accept a stream of bytes and emit complete JSON-RPC messages exactly once, in order, terminated by `\n`. |
| **FR-RPC-011** | The decoder MUST handle multi-byte UTF-8 sequences that are split across chunk boundaries without corruption. |
| **FR-RPC-012** | The decoder MUST skip empty lines without emitting a message or an error. |
| **FR-RPC-013** | The decoder MUST log a warning to stderr and drop the line on malformed JSON; it MUST NOT crash or terminate the process. |
| **FR-RPC-014** | The decoder MUST buffer partial lines until a `\n` arrives or the stream is closed. |
| **FR-RPC-015** | The decoder MUST emit any final complete message buffered when the stream ends. |
| **FR-RPC-016** | The decoder MUST NOT impose a maximum message size in MVP; large messages SHOULD pass through unchanged. (NFR-PERF-004 sets a soft bound.) |

### 6.3 Frame Encoder

| ID | Requirement |
|---|---|
| **FR-RPC-020** | The encoder `encodeFrame(msg)` MUST produce a JSON-stringified message followed by a single `\n`. |
| **FR-RPC-021** | The encoder MUST NOT insert extra whitespace, BOM, or framing other than the trailing newline. |

---

## 7. Subsystem: Stdio Transport (FR-TRANS)

**Module:** `src/transport/stdio.ts`

| ID | Requirement |
|---|---|
| **FR-TRANS-001** | The transport MUST spawn the target as `child_process.spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "inherit"] })` using the values from `target.command`, `target.args`, `target.env` (merged with `process.env`), and `target.cwd`. |
| **FR-TRANS-002** | The transport MUST wire one Frame Decoder to `process.stdin` (client→target direction). |
| **FR-TRANS-003** | The transport MUST wire one Frame Decoder to `child.stdout` (target→client direction). |
| **FR-TRANS-004** | The transport MUST pass every decoded frame through the pipeline (FR-PIPE-*), then write the resulting frame to the opposite stream using the Frame Encoder. |
| **FR-TRANS-005** | The transport MUST close the target's stdin when `process.stdin` reaches EOF, then await the child's exit. |
| **FR-TRANS-006** | The transport MUST detect target-side termination (child exit) and exit the JanuScope process with the same exit code, after flushing pending audit writes. |
| **FR-TRANS-007** | The transport MUST inherit the child's `stderr` directly to JanuScope's `stderr` so target diagnostics remain visible. |
| **FR-TRANS-008** | The transport MUST handle write back-pressure: if a downstream stream's write buffer is full, the transport MUST wait for `drain` before continuing. |
| **FR-TRANS-009** | The transport MUST NOT crash on a malformed frame from either side; it MUST log and continue. |

---

## 8. Subsystem: Pipeline Orchestrator (FR-PIPE)

**Module:** `src/pipeline.ts`

### 8.1 Overlay Contract

| ID | Requirement |
|---|---|
| **FR-PIPE-001** | An overlay MUST be an object conforming to the `Overlay` interface: `{ name, kind?, setup?, teardown?, onClientMessage?, onServerMessage? }`. |
| **FR-PIPE-002** | `kind` MUST be one of `"gate"` or `"observer"` (default `"observer"`). |
| **FR-PIPE-003** | The orchestrator MUST call `setup(ctx)` for each registered overlay before the message loop begins; setup failures MUST abort startup with exit code 1. |
| **FR-PIPE-004** | The orchestrator MUST call `teardown(ctx)` for each registered overlay during shutdown, regardless of whether shutdown was clean or due to error. |

### 8.2 Message Flow

| ID | Requirement |
|---|---|
| **FR-PIPE-010** | For each incoming client message, the orchestrator MUST invoke each overlay's `onClientMessage` handler **in registration order**, awaiting each before invoking the next. |
| **FR-PIPE-011** | For each incoming server message, the orchestrator MUST invoke each overlay's `onServerMessage` handler **in registration order**, awaiting each before invoking the next. |
| **FR-PIPE-012** | An overlay's handler MAY return one of: a forwarded message (possibly modified), a short-circuit response (terminates the chain and is delivered to the originator), or nothing (default: forward unchanged). |
| **FR-PIPE-013** | An overlay MUST be able to inject an additional message via `ctx.inject(direction, msg)`; injected messages MUST be sent without re-entering the pipeline. |
| **FR-PIPE-014** | The orchestrator MUST support multiple concurrent in-flight requests; each request/response chain runs independently. |
| **FR-PIPE-015** | The orchestrator MUST preserve the order in which client messages enter the pipeline (FIFO per direction). |
| **FR-PIPE-016** | Registration order of overlays MUST be: `audit` first (so it sees the rawest message), followed by gates (`block`, `sqlGuard`, `rateLimit`, `toolSurface`), then observers/decorators (`instructions`, `dbSchema`, `contextInjection`), with `redact` last on the server→client direction. The exact order is defined by the configuration loader (FR-CFG-020). |

### 8.3 Error Semantics

| ID | Requirement |
|---|---|
| **FR-PIPE-020** | If an overlay of `kind: "gate"` throws or rejects, the orchestrator MUST short-circuit with a `-32603 InternalError` response and MUST NOT forward the message. |
| **FR-PIPE-021** | If an overlay of `kind: "observer"` throws or rejects, the orchestrator MUST log the error to stderr and continue with the message unmodified (fail-open). |
| **FR-PIPE-022** | Errors in setup or teardown of any overlay MUST be logged, and setup errors MUST abort startup. |

### 8.4 OverlayContext

| ID | Requirement |
|---|---|
| **FR-PIPE-030** | `OverlayContext` MUST expose: `log(level, message, data?)`, a per-overlay `state` object, `forward(msg)`, `inject(direction, msg)`, `respond(msg)`, and a telemetry span handle. |
| **FR-PIPE-031** | `ctx.log` MUST prefix messages with `[januscope:<overlayName>]` and route them to stderr. |
| **FR-PIPE-032** | `ctx.state` MUST be scoped to a single overlay and persist for the lifetime of the session. |

---

## 9. Subsystem: Configuration Loader (FR-CFG)

**Module:** `src/config.ts`

### 9.1 Entry Points

| ID | Requirement |
|---|---|
| **FR-CFG-001** | The loader MUST expose a synchronous entry `loadConfig(path, env)` for configs that contain only env-var and literal values. |
| **FR-CFG-002** | The loader MUST expose an asynchronous entry `loadConfigAsync(path, env)` for configs that may contain secret-backend references (`vault://`, `aws-sm://`, `1pw://`). |
| **FR-CFG-003** | If `loadConfig` (sync) is invoked on a config containing async secret refs, it MUST throw an error with a message instructing the caller to use `loadConfigAsync`. |

### 9.2 File Format

| ID | Requirement |
|---|---|
| **FR-CFG-005** | The loader MUST autodetect YAML vs. JSON by file extension (`.yaml`, `.yml` → YAML; `.json` → JSON). |
| **FR-CFG-006** | YAML parsing MUST use `js-yaml`'s safe load (no arbitrary object instantiation). |
| **FR-CFG-007** | Parse errors MUST be reported with file path, line, and column when available. |

### 9.3 Environment Substitution

| ID | Requirement |
|---|---|
| **FR-CFG-010** | The loader MUST substitute `${VAR}` and `$VAR` references with the value from `env` (default: `process.env`). |
| **FR-CFG-011** | Substitution MUST occur inside any string value, including nested objects, array elements, and within larger strings (interpolation). |
| **FR-CFG-012** | A missing variable MUST result in an empty-string substitution and a single-line warning to stderr; substitution MUST NOT be a fatal error. |
| **FR-CFG-013** | The loader MUST expose a helper `substituteEnv(value, env, options)` for external use. |
| **FR-CFG-014** | The loader MUST expose a helper `detectSecretRefs(value)` that returns `true` if any `vault://`, `aws-sm://`, or `1pw://` reference exists anywhere in the value. |

### 9.4 Validation

| ID | Requirement |
|---|---|
| **FR-CFG-015** | Validation MUST use a Zod schema named `OverlayConfigSchema` exported from this module. |
| **FR-CFG-016** | Validation errors MUST be presented as a numbered list of `<path>: <reason>` lines to stderr, then the loader MUST throw. |
| **FR-CFG-017** | Unknown top-level keys MUST be rejected (strict mode). |
| **FR-CFG-018** | Required field `target.command` (string, non-empty) MUST be enforced. |

### 9.5 Normalization

| ID | Requirement |
|---|---|
| **FR-CFG-019** | Path-valued fields (`audit.sink`, `contextInjection.textFile`, `target.cwd`) MUST be normalized: `~/` expanded to user home, relative paths resolved against the config file's directory, absolute paths used as-is. |
| **FR-CFG-020** | The loader MUST produce an overlay registration order such that `audit` is first, gates come before decorators, and `redact` is last for server→client messages. |
| **FR-CFG-021** | Default values MUST be applied for every optional field (e.g., `audit.logRawArgs = false`, `sqlGuard.sqlArg = "sql"`, `sqlGuard.readOnly = true`, `sqlGuard.mode = "allowlist"`, `redact.replacement = "[REDACTED]"`, `redact.applyTo = "text"`, `instructions.position = "append"`, `contextInjection.position = "append"`, `dbSchema.format = "markdown"`, `dbSchema.includeComments = true`, `dbSchema.refresh = "startup"`). |

### 9.6 Output

| ID | Requirement |
|---|---|
| **FR-CFG-022** | The loader MUST return a typed `OverlayConfig` object suitable for the pipeline orchestrator. |
| **FR-CFG-023** | The loader MUST export `validateConfig(input)` for ad-hoc validation by external tools (notably FR-VAL). |

---

## 10. Subsystem: Secret Resolver (FR-SEC)

**Module:** `src/secrets.ts`

| ID | Requirement |
|---|---|
| **FR-SEC-001** | The resolver MUST recognize three URI schemes: `vault://path#field` (HashiCorp Vault), `aws-sm://arn#field` (AWS Secrets Manager), `1pw://op://vault/item/field` (1Password CLI). |
| **FR-SEC-002** | The resolver MUST expose `parseSecretRef(ref)` returning `{ scheme, path, field? }`. |
| **FR-SEC-003** | The resolver MUST expose `resolveAllSecretRefs(value)`, an async traversal that replaces every reference in the input (recursing through objects and arrays) with the resolved value. |
| **FR-SEC-004** | The resolver MUST lazy-load each backend SDK on first use; absence of an SDK MUST cause a clear, actionable error only if a matching reference exists. |
| **FR-SEC-005** | Vault resolution MUST authenticate via the environment variables `VAULT_ADDR` and `VAULT_TOKEN` (default Vault SDK behavior). |
| **FR-SEC-006** | AWS Secrets Manager resolution MUST use the default AWS credential provider chain. |
| **FR-SEC-007** | 1Password resolution MUST invoke the `op` CLI; if not installed, the error MUST recommend installation. |
| **FR-SEC-008** | The resolver MUST NOT cache resolved secret values to disk. In-memory caching for the lifetime of the process is permitted. |
| **FR-SEC-009** | A failed resolution MUST abort startup (exit code 1) with a message that names the failed reference but does **not** echo any sensitive material to stderr. |

---

## 11. Subsystem: Quarantine & Trust (FR-QUAR)

**Module:** `src/quarantine.ts`

### 11.1 Activation

| ID | Requirement |
|---|---|
| **FR-QUAR-001** | The quarantine subsystem MUST be inactive unless the config contains `firstRun: approve`. |

### 11.2 Static Fingerprint

| ID | Requirement |
|---|---|
| **FR-QUAR-002** | The system MUST compute a static fingerprint as a SHA-256 hash over a canonicalized representation of: `target.command`, `target.args`, `block`, `sqlGuard`, `rateLimit`, `redact`, `classification`. |
| **FR-QUAR-003** | Per-component sub-hashes MUST be computed and exposed for diagnostics (so operators can identify *which* component drifted). |
| **FR-QUAR-004** | Canonicalization MUST produce a stable output regardless of YAML key ordering or whitespace. |

### 11.3 Live Tool Fingerprint

| ID | Requirement |
|---|---|
| **FR-QUAR-005** | The system MUST compute a live tool fingerprint as a SHA-256 hash over the array of `{ name, description, inputSchema, annotations? }` of every tool returned by the target's `tools/list` response. |
| **FR-QUAR-006** | The fingerprint MUST be order-independent (tools sorted by `name` before hashing). |

### 11.4 Approval Store

| ID | Requirement |
|---|---|
| **FR-QUAR-010** | The system MUST persist approvals to `~/.januscope/approved.json`. |
| **FR-QUAR-011** | The file MUST be JSON, with one entry per approved config keyed by config file path (or by a stable derived ID). |
| **FR-QUAR-012** | Each entry MUST include: static fingerprint, sub-hashes, live tool fingerprint (once observed), approval timestamp, and the JanuScope version. |
| **FR-QUAR-013** | File creation MUST set mode `0600` on Unix-like systems. |

### 11.5 Check & Record APIs

| ID | Requirement |
|---|---|
| **FR-QUAR-020** | `checkQuarantine(config)` MUST return `{ approved: boolean, drift?: string[] }` where `drift` lists the names of components whose sub-hash differs from the approved entry. |
| **FR-QUAR-021** | `recordApproval(config)` MUST write a new entry (or replace an existing one) atomically (write to temp file, then rename). |
| **FR-QUAR-022** | `checkLiveTools(entry, tools)` MUST return `{ approved: boolean, drift?: { added: string[], removed: string[], modified: string[] } }`. |
| **FR-QUAR-023** | `recordLiveToolsApproval(entry, tools)` MUST atomically update the live fingerprint for the entry. |

### 11.6 Runtime Behavior

| ID | Requirement |
|---|---|
| **FR-QUAR-030** | On launch with `firstRun: approve` and no existing approval entry, the system MUST record the static fingerprint, log "first-use approval recorded for <config>" to stderr, and proceed. |
| **FR-QUAR-031** | On launch with `firstRun: approve` and an entry that differs from the current static fingerprint, the system MUST refuse to start with exit code 1 and a message listing the drifted components. The recovery instruction MUST mention `januscope approve --config <path>`. |

---

## 12. Subsystem: Target Probe (FR-PROBE)

**Module:** `src/probe.ts`

| ID | Requirement |
|---|---|
| **FR-PROBE-001** | The probe MUST spawn the target with the same `command`, `args`, `env`, and `cwd` that the runtime would use. |
| **FR-PROBE-002** | The probe MUST perform the MCP handshake: send `initialize`, receive `initialize` response, send `initialized` notification. |
| **FR-PROBE-003** | The probe MUST send `tools/list` and collect the resulting tools array. |
| **FR-PROBE-004** | The probe MUST attempt a clean shutdown (send `shutdown` if the server's capabilities advertise it; otherwise close stdin). |
| **FR-PROBE-005** | The probe MUST return `{ tools: LiveTool[], serverInfo }`. |
| **FR-PROBE-006** | The probe MUST enforce a default timeout of 90 seconds for the full handshake-through-tools-list sequence; on timeout it MUST kill the child and throw. |
| **FR-PROBE-007** | The probe timeout MUST be overridable via a CLI flag or function parameter. |
| **FR-PROBE-008** | Probe failures MUST report whether the failure was during spawn, handshake, or tools/list to ease debugging. |

---

## 13. Subsystem: Telemetry (FR-TEL)

**Module:** `src/telemetry.ts`

| ID | Requirement |
|---|---|
| **FR-TEL-001** | The system MUST expose a `NOOP_TRACER` constant that satisfies the tracer interface but performs no I/O. |
| **FR-TEL-002** | When `telemetry.otel.endpoint` is not configured, all telemetry call sites MUST use `NOOP_TRACER`; no OTel SDK SHALL be loaded into memory. |
| **FR-TEL-003** | When `telemetry.otel.endpoint` is configured, the system MUST lazily import `@opentelemetry/api`, `@opentelemetry/sdk-node`, and `@opentelemetry/exporter-trace-otlp-http`, and create a real tracer using `telemetry.otel.serviceName` and `telemetry.otel.headers`. |
| **FR-TEL-004** | One span MUST be created per `handleClientMessage` call. |
| **FR-TEL-005** | One span MUST be created per `handleServerMessage` call. |
| **FR-TEL-006** | One nested span MUST be created per overlay invocation. |
| **FR-TEL-007** | Each span MUST carry the attributes (when applicable): `mcp.method`, `mcp.tool_name`, `januscope.overlay`, `januscope.classification`, `januscope.outcome`. |
| **FR-TEL-008** | Telemetry failures (exporter unreachable, network error) MUST be logged at most once per minute and MUST NOT block or slow the pipeline. |

---

## 14. Subsystem: Boot Summary (FR-BOOT)

**Module:** `src/boot-summary.ts`

| ID | Requirement |
|---|---|
| **FR-BOOT-001** | The system MUST print a startup banner to stderr immediately after configuration validation but before the first message is processed. |
| **FR-BOOT-002** | The banner MUST include: JanuScope version, target command (truncated to ~60 chars), list of active overlays with key settings, audit sink path (if configured), classification level (if set). |
| **FR-BOOT-003** | The banner MUST be suppressed if either `JANUSCOPE_QUIET=1` or `JANUSCOPE_NO_BOOT_SUMMARY=1` is set in the environment. |
| **FR-BOOT-004** | The banner MUST NEVER be written to stdout. |
| **FR-BOOT-005** | The banner MUST be deterministic for a given config (same input → identical output) so it can be diff'd across runs. |

---

## 15. Subsystem: Lens Discovery (FR-LENS)

**Module:** `src/lenses.ts`

### 15.1 Discovery

| ID | Requirement |
|---|---|
| **FR-LENS-001** | The discovery module MUST walk `lenses/<category>/<name>/` directories rooted at the bundled lenses dir. |
| **FR-LENS-002** | A helper `findBundledLensesDir()` MUST locate the lenses directory relative to the running script, working in both source layout and installed npm package layout. |
| **FR-LENS-003** | For each lens directory, the module MUST read `config.yaml` and `README.md`. |

### 15.2 Frontmatter

| ID | Requirement |
|---|---|
| **FR-LENS-010** | The module MUST parse YAML frontmatter from `README.md` files: a `---` opening fence on line 1, YAML body, `---` closing fence, then markdown. |
| **FR-LENS-011** | A helper `splitFrontmatter(text)` MUST return `{ frontmatter: object \| null, body: string }`. |
| **FR-LENS-012** | Required frontmatter fields: `mcp` (string), `category` (one of the allowed categories), `status` (one of the allowed statuses). |
| **FR-LENS-013** | Optional fields: `mcpUrl`, `testedVersion`, `testedAt`, `maintainer`, `tags`. |

### 15.3 Constants & Stale Detection

| ID | Requirement |
|---|---|
| **FR-LENS-020** | The module MUST export `LENS_CATEGORIES = ["databases", "dev-tools", "saas", "infra", "other"]`. |
| **FR-LENS-021** | The module MUST export `LENS_STATUSES = ["probed", "active", "unverified", "stale", "archived"]`. |
| **FR-LENS-022** | The module MUST export `STALE_THRESHOLD_MONTHS = 6`. |
| **FR-LENS-023** | A lens MUST be flagged `isStale: true` if its `testedAt` is older than `STALE_THRESHOLD_MONTHS` from the current date, regardless of its declared `status`. |

### 15.4 Loader API

| ID | Requirement |
|---|---|
| **FR-LENS-030** | `loadLenses(options)` MUST return an array of `Lens` objects, each containing: directory path, parsed config, parsed frontmatter, full README body, and `isStale` flag. |
| **FR-LENS-031** | `loadLenses(options)` MUST accept an optional `category` filter and an optional `search` string (matched against name, tags, and description). |

---

## 16. Overlay: Audit (FR-AUDIT)

**Module:** `src/overlays/audit.ts`
**Kind:** Observer.

### 16.1 Configuration

| ID | Requirement |
|---|---|
| **FR-AUDIT-001** | The overlay MUST accept `audit.sink` as either a file path, the literal string `"stderr"`, or the literal string `"stdout"`. |
| **FR-AUDIT-002** | The overlay MUST accept `audit.logRawArgs` as a boolean, defaulting to `false`. |
| **FR-AUDIT-003** | When `audit` is omitted from the config, no audit records SHALL be emitted. |

### 16.2 Event Types

| ID | Requirement |
|---|---|
| **FR-AUDIT-010** | The overlay MUST emit an event of type `startup` when the pipeline initializes. The event MUST include: timestamp (ISO 8601), JanuScope version, lens name (if available), sink path. |
| **FR-AUDIT-011** | The overlay MUST emit an event of type `shutdown` when the pipeline terminates. The event MUST include: reason (`client_eof`, `target_exit`, `error`, `signal`), exit code, and duration. |
| **FR-AUDIT-012** | For each successful `tools/call` response, the overlay MUST emit an event of type `tools/call ok`. |
| **FR-AUDIT-013** | For each error response to a `tools/call`, the overlay MUST emit an event of type `tools/call error` including the JSON-RPC error code and message. |
| **FR-AUDIT-014** | For each `tools/call` request that does not receive a matching response within an internal timeout (default 5 minutes), the overlay MUST emit an event of type `tools/call timeout`. |
| **FR-AUDIT-015** | For each response received whose `id` has no matching outstanding request, the overlay MUST emit an event of type `tools/call orphaned`. |

### 16.3 Event Fields

| ID | Requirement |
|---|---|
| **FR-AUDIT-020** | Every `tools/call` event MUST include: `timestamp`, `tool_name`, `args_hash` (SHA-256 of canonicalized args, hex), `outcome` (`ok`, `error`, `timeout`, `orphaned`). |
| **FR-AUDIT-021** | When `logRawArgs: true`, every `tools/call` event MUST also include the raw `args` object. |
| **FR-AUDIT-022** | Every event MUST include the `lens_name` and `lens_version` (if known), and the `classification` (if set in config). |
| **FR-AUDIT-023** | Every event MUST include the identity fields when the corresponding env vars are set: `user` from `JANUSCOPE_USER`, `team` from `JANUSCOPE_TEAM`, `session` from `JANUSCOPE_SESSION`. |
| **FR-AUDIT-024** | An event MAY include `response_hash` (SHA-256 of canonicalized response). This is RECOMMENDED for non-sensitive responses. |

### 16.4 Write Semantics

| ID | Requirement |
|---|---|
| **FR-AUDIT-030** | Each event MUST be a single line of valid JSON, terminated by `\n`. |
| **FR-AUDIT-031** | Writes MUST be asynchronous and MUST NOT block the pipeline. |
| **FR-AUDIT-032** | Write errors (disk full, sink unavailable) MUST be logged to stderr at most once per minute and MUST NOT cause the pipeline to fail. |
| **FR-AUDIT-033** | On shutdown, the overlay MUST flush any buffered writes before the process exits. |
| **FR-AUDIT-034** | When the sink is a file, the file MUST be opened in append mode and created with mode `0600` if newly created. |

### 16.5 JSON Schema

| ID | Requirement |
|---|---|
| **FR-AUDIT-040** | The system MUST ship a JSON Schema (Draft 2020-12) at `schemas/audit-event.json` that describes every audit event type. |
| **FR-AUDIT-041** | The schema MUST validate every event the system actually emits in its tests. |

---

## 17. Overlay: Block (FR-BLOCK)

**Module:** `src/overlays/block.ts`
**Kind:** Gate.

| ID | Requirement |
|---|---|
| **FR-BLOCK-001** | The overlay MUST accept `block` as a list of strings, each being either an exact tool name or a glob pattern containing `*`. |
| **FR-BLOCK-002** | When no `block` rules exist, the overlay MUST add zero overhead to message processing. |
| **FR-BLOCK-003** | Glob semantics: `*` MUST match any sequence of characters **except** `_`. This makes `admin_*` match `admin_delete` but not `namespace:admin_foo`. |
| **FR-BLOCK-004** | On a `tools/call` request whose `name` matches any block rule, the overlay MUST short-circuit with a `-32601 MethodNotFound` error response. |
| **FR-BLOCK-005** | On a `tools/list` response, the overlay MUST remove any tool whose `name` matches any block rule from the returned tools array. |
| **FR-BLOCK-006** | Matching MUST be case-sensitive. |
| **FR-BLOCK-007** | The overlay MUST log at debug level the name and matching rule for every block decision. |

---

## 18. Overlay: SQL Guard (FR-SQL)

**Module:** `src/overlays/sqlGuard.ts`
**Kind:** Gate.

### 18.1 Configuration

| ID | Requirement |
|---|---|
| **FR-SQL-001** | The overlay MUST accept `sqlGuard.tools` (list of tool names whose calls are inspected). |
| **FR-SQL-002** | The overlay MUST accept `sqlGuard.sqlArg` (name of the argument carrying the SQL string), defaulting to `"sql"`. |
| **FR-SQL-003** | The overlay MUST accept `sqlGuard.readOnly` (boolean), defaulting to `true`. When `false`, the overlay is inert. |
| **FR-SQL-004** | The overlay MUST accept `sqlGuard.mode` of `"allowlist"` (default) or `"denylist"`. |
| **FR-SQL-005** | The overlay MUST accept `sqlGuard.extraWriteKeywords` (list of strings, used only in denylist mode). |
| **FR-SQL-006** | The overlay MUST accept `sqlGuard.extraReadVerbs` (list of strings, used only in allowlist mode). |

### 18.2 Allowlist Mode

| ID | Requirement |
|---|---|
| **FR-SQL-010** | In allowlist mode, the **leading verb** of each statement MUST be one of: `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `DESC`, `VALUES`, `PRAGMA`, `TABLE`, plus any in `extraReadVerbs`. |
| **FR-SQL-011** | Comparison MUST be case-insensitive. |

### 18.3 Denylist Mode

| ID | Requirement |
|---|---|
| **FR-SQL-020** | In denylist mode, the overlay MUST reject any statement containing the keywords: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `MERGE`, `REPLACE`, `RENAME`, `COMMENT`, `LOCK`, `CALL`, `EXEC`, `EXECUTE`, `DO`, plus any in `extraWriteKeywords`. |
| **FR-SQL-021** | Keyword matching MUST be word-boundary aware (so the substring `update` inside `updated_at` MUST NOT trigger a match). |

### 18.4 Pre-Processing

| ID | Requirement |
|---|---|
| **FR-SQL-030** | Before analysis, the overlay MUST strip SQL comments: line comments `-- ...`, block comments `/* ... */` (including nested). |
| **FR-SQL-031** | Before analysis, the overlay MUST blank the contents of string literals (`'...'`, `"..."`, dollar-quoted `$$...$$`), preserving delimiters and total length, so injected SQL keywords inside strings are not falsely flagged. |
| **FR-SQL-032** | The overlay MUST normalize whitespace to single spaces. |
| **FR-SQL-033** | The overlay MUST split on `;` for multi-statement detection. All statements MUST pass; if any one fails the policy check, the entire request MUST be rejected. |

### 18.5 Response

| ID | Requirement |
|---|---|
| **FR-SQL-040** | On rejection, the overlay MUST short-circuit with a `-32602 InvalidParams` error response. |
| **FR-SQL-041** | The error message MUST identify (a) the tool name, (b) the offending statement (truncated to 200 chars), and (c) the reason (e.g., "leading verb 'UPDATE' is not allowed in allowlist mode"). |

### 18.6 Evasion Resistance

| ID | Requirement |
|---|---|
| **FR-SQL-050** | The overlay MUST correctly reject statements that attempt to hide writes inside comments (e.g., `SELECT 1; /* UPDATE users SET ... */ DROP TABLE x`). |
| **FR-SQL-051** | The overlay MUST correctly reject UTF-8 obfuscation attempts (e.g., zero-width spaces inside keywords). |
| **FR-SQL-052** | The overlay MUST correctly reject Postgres `DO` blocks containing writes. |
| **FR-SQL-053** | The overlay MUST set a per-statement parser timeout/length cap (NFR-PERF-005) to defeat denial-of-service via pathologically long input. |

---

## 19. Overlay: Redact (FR-RDCT)

**Module:** `src/overlays/redact.ts`
**Kind:** Observer.

### 19.1 Configuration

| ID | Requirement |
|---|---|
| **FR-RDCT-001** | The overlay MUST accept `redact.rules` as a list, each entry being either `{ regex: "<pattern>" }` or `{ field: "<json-path>" }`. |
| **FR-RDCT-002** | The overlay MUST accept `redact.replacement` (string), defaulting to `"[REDACTED]"`. |
| **FR-RDCT-003** | The overlay MUST accept `redact.applyTo` of `"text"` (default), `"fields"`, or `"all"`. |

### 19.2 Regex Rules

| ID | Requirement |
|---|---|
| **FR-RDCT-010** | Regex patterns MUST be compiled with case-insensitive flag by default. |
| **FR-RDCT-011** | Invalid regex patterns MUST cause a validation error at config-load time (FR-CFG-015). |
| **FR-RDCT-012** | Regex matches MUST be replaced with the configured replacement string in all matching positions (global). |

### 19.3 Field Rules

| ID | Requirement |
|---|---|
| **FR-RDCT-020** | Field paths MUST support dotted notation (e.g., `user.email`). |
| **FR-RDCT-021** | Field paths MUST support `*` matching exactly one path segment. |
| **FR-RDCT-022** | Field paths MUST support `**` matching any number of path segments (including zero). |
| **FR-RDCT-023** | Field rules MUST be applied to JSON object payloads of MCP responses. |

### 19.4 Apply Modes

| ID | Requirement |
|---|---|
| **FR-RDCT-030** | In `text` mode (default): apply regex rules to MCP text content blocks; additionally, if a text block contains valid JSON, parse it and apply field rules to the parsed object. |
| **FR-RDCT-031** | In `fields` mode: apply only field rules. |
| **FR-RDCT-032** | In `all` mode: apply regex rules to every string value at every level of the response. |

### 19.5 Pre-Mutation Cloning

| ID | Requirement |
|---|---|
| **FR-RDCT-040** | The overlay MUST deep-clone the response before mutating, so prior overlays (notably `audit`) have observed the un-redacted version. |
| **FR-RDCT-041** | The deep-clone MUST preserve JSON types exactly (no coercion of numbers to strings, etc.). |

---

## 20. Overlay: Instructions (FR-INST)

**Module:** `src/overlays/instructions.ts`
**Kind:** Observer.

### 20.1 Configuration

| ID | Requirement |
|---|---|
| **FR-INST-001** | The overlay MUST accept `instructions` as either a string (treated as `{ text: <string>, position: "append" }`) or an object `{ text, position }`. |
| **FR-INST-002** | `position` MUST be `"append"` (default) or `"prepend"`. |

### 20.2 Tool Description Modification

| ID | Requirement |
|---|---|
| **FR-INST-010** | On every `tools/list` response, the overlay MUST modify each tool's `description` field by appending or prepending the configured text (with a separator newline). |
| **FR-INST-011** | If a tool has no `description`, the overlay MUST set its description to the configured text. |
| **FR-INST-012** | Modification MUST NOT mutate the original response; it MUST work on a clone. |

### 20.3 Classification Banner

| ID | Requirement |
|---|---|
| **FR-INST-020** | When the config has `classification: <level>`, the overlay MUST automatically prepend a classification banner to every tool description. |
| **FR-INST-021** | Banner text MUST be: `public` → `CLASSIFICATION: PUBLIC — no special handling required.`; `internal` → `CLASSIFICATION: INTERNAL — do not expose raw values to end users.`; `sensitive` → `CLASSIFICATION: SENSITIVE — PII, financial, or regulated data. Aggregate or anonymize.` |
| **FR-INST-022** | The classification banner MUST be applied even if `instructions` is not otherwise configured. |

---

## 21. Overlay: Rate Limit (FR-RATE)

**Module:** `src/overlays/rateLimit.ts`
**Kind:** Gate.

### 21.1 Configuration

| ID | Requirement |
|---|---|
| **FR-RATE-001** | The overlay MUST accept `rateLimit` as a list of `{ tool, perMinute }` objects. |
| **FR-RATE-002** | `tool` MUST be either an exact name or a glob pattern (same semantics as `block`). |
| **FR-RATE-003** | `perMinute` MUST be a positive number; fractional values (e.g., `0.5`) are allowed. |

### 21.2 Bucket Algorithm

| ID | Requirement |
|---|---|
| **FR-RATE-010** | The overlay MUST maintain a separate token bucket per (rule, tool name) pair. A glob rule matching multiple tool names MUST result in separate buckets per tool. |
| **FR-RATE-011** | Bucket capacity MUST be `max(perMinute, 1)`. |
| **FR-RATE-012** | Refill rate MUST be `perMinute / 60` tokens per second. |
| **FR-RATE-013** | Each matching `tools/call` request MUST consume one token. |
| **FR-RATE-014** | When the bucket is empty, the overlay MUST short-circuit with a JSON-RPC error using code `-32000` (server-error band, semantically equivalent to HTTP 429). |
| **FR-RATE-015** | The error message MUST include: tool name, the rule that triggered, current rate, and (advisory) suggested retry-after seconds. |

### 21.3 Concurrency

| ID | Requirement |
|---|---|
| **FR-RATE-020** | Bucket state MUST be safe under concurrent in-flight requests within a single JanuScope process. |
| **FR-RATE-021** | Buckets MUST NOT persist across process restarts (each session starts fresh). |

---

## 22. Overlay: DB Schema Injection (FR-SCHEMA)

**Module:** `src/overlays/db-schema/`
**Kind:** Observer.

### 22.1 Configuration

| ID | Requirement |
|---|---|
| **FR-SCHEMA-001** | The overlay MUST accept `dbSchema.driver` of `"postgres"`, `"mysql"`, or `"sqlite"`. When omitted, the driver MUST be inferred from `connectionString` prefix (`postgres://`, `postgresql://` → postgres; `mysql://` → mysql; `sqlite:`, file path with `.db`, `.sqlite` → sqlite). |
| **FR-SCHEMA-002** | The overlay MUST accept `dbSchema.connectionString` (required). |
| **FR-SCHEMA-003** | The overlay MUST accept `dbSchema.tables` (optional whitelist of table names; glob patterns allowed). |
| **FR-SCHEMA-004** | The overlay MUST accept `dbSchema.excludeTables` (optional blacklist; glob patterns allowed). |
| **FR-SCHEMA-005** | The overlay MUST accept `dbSchema.schemas` (Postgres only; defaults to `["public"]`). |
| **FR-SCHEMA-006** | The overlay MUST accept `dbSchema.injectInto` (list of tool names whose descriptions are decorated); default: `["query", "execute", "execute_sql", "search", "pg_query", "mysql_query", "sql"]`. |
| **FR-SCHEMA-007** | The overlay MUST accept `dbSchema.format` of `"markdown"` (default), `"ddl"`, or `"compact"`. |
| **FR-SCHEMA-008** | The overlay MUST accept `dbSchema.includeComments` (boolean, default `true`). |
| **FR-SCHEMA-009** | The overlay MUST accept `dbSchema.refresh` of `"startup"` (default) or `"never"`. |

### 22.2 Introspection (per driver)

| ID | Requirement |
|---|---|
| **FR-SCHEMA-020** | Each driver MUST expose `introspect(options): SchemaSnapshot`. |
| **FR-SCHEMA-021** | A `SchemaSnapshot` MUST include, per table: table name, schema/namespace, columns (name, type, nullability, default), primary key columns, foreign keys (column → referenced table.column), indexes, constraints, and (when available and `includeComments: true`) column/table comments. |
| **FR-SCHEMA-022** | Each driver MUST be lazy-loaded; absence of the required client library MUST produce an error pointing to install instructions, only if `dbSchema` is used. |
| **FR-SCHEMA-023** | Each driver MUST honor `tables` and `excludeTables` filters. |

### 22.3 Format Engines

| ID | Requirement |
|---|---|
| **FR-SCHEMA-030** | The `markdown` engine MUST emit one section per table, with columns rendered as a Markdown table. |
| **FR-SCHEMA-031** | The `ddl` engine MUST emit syntactically valid `CREATE TABLE` statements per table, with all constraints. |
| **FR-SCHEMA-032** | The `compact` engine MUST emit one line per table in the form `table_name(col1 PK, col2 UNIQUE, col3)`. |

### 22.4 Injection

| ID | Requirement |
|---|---|
| **FR-SCHEMA-040** | At pipeline setup, the overlay MUST connect to the DB, introspect, and cache the formatted schema string. |
| **FR-SCHEMA-041** | On every `tools/list` response, the overlay MUST append the schema string to each matching tool's description. |
| **FR-SCHEMA-042** | If introspection fails at startup (DB unreachable, auth error), the overlay MUST log a warning to stderr and continue with no injection. The pipeline MUST NOT fail. (Fails-open per FR-PIPE-021.) |
| **FR-SCHEMA-043** | When `refresh: never`, the schema MUST be introspected exactly once at startup. (No periodic refresh in MVP.) |

---

## 23. Overlay: Context Injection (FR-CTX)

**Module:** `src/overlays/contextInjection.ts`
**Kind:** Observer.

### 23.1 Configuration

| ID | Requirement |
|---|---|
| **FR-CTX-001** | The overlay MUST accept `contextInjection.injectInto` (list of tool names; at least one required). |
| **FR-CTX-002** | The overlay MUST accept exactly one of `contextInjection.text` (inline string) or `contextInjection.textFile` (path). Specifying both or neither MUST be a validation error. |
| **FR-CTX-003** | The overlay MUST accept `contextInjection.position` of `"append"` (default) or `"prepend"`. |

### 23.2 Path Resolution

| ID | Requirement |
|---|---|
| **FR-CTX-010** | Absolute `textFile` paths MUST be used as-is. |
| **FR-CTX-011** | Relative `textFile` paths MUST be resolved against the directory of the config file. |
| **FR-CTX-012** | A leading `~/` in `textFile` MUST be expanded to the user's home directory. |

### 23.3 Behavior

| ID | Requirement |
|---|---|
| **FR-CTX-020** | The file MUST be read at startup; runtime changes to the file MUST NOT affect the current session. |
| **FR-CTX-021** | On every `tools/list` response, the overlay MUST append or prepend the context text to each matching tool's description. |
| **FR-CTX-022** | If the file is missing or unreadable at startup, the overlay MUST log a warning and skip injection (fails open). |

---

## 24. Overlay: Tool Surface Drift (FR-DRIFT)

**Module:** `src/overlays/toolSurface.ts`
**Kind:** Gate.

| ID | Requirement |
|---|---|
| **FR-DRIFT-001** | The overlay MUST be active only when the config has `firstRun: approve`. |
| **FR-DRIFT-002** | The overlay MUST inspect the first `tools/list` response of the session. |
| **FR-DRIFT-003** | The overlay MUST compute the live tools fingerprint (FR-QUAR-005) and compare it to the stored approval entry. |
| **FR-DRIFT-004** | If no approval entry exists for live tools, the overlay MUST record the current fingerprint, log "tools approved on first use" to stderr, and pass the response through. |
| **FR-DRIFT-005** | If the fingerprint differs from the approved one, the overlay MUST rewrite the `tools/list` response to a JSON-RPC error explaining the drift (added/removed/modified tools). |
| **FR-DRIFT-006** | Once drift is detected in a session, the overlay MUST also fail every subsequent `tools/list` response with the same drift error. ("Sticky failure": a session cannot recover without operator approval.) |
| **FR-DRIFT-007** | The drift error message MUST instruct the operator to run `januscope approve --config <path>` to re-baseline. |

---

## 25. Subsystem: Command-Line Interface (FR-CLI)

**Module:** `src/cli.ts`

### 25.1 Primary Modes

| ID | Requirement |
|---|---|
| **FR-CLI-001** | `januscope --config <path>` MUST launch the policy proxy using the specified config file. |
| **FR-CLI-002** | `januscope --version` MUST print the program's version string and exit 0. |
| **FR-CLI-003** | `januscope --help` (and `-h`) MUST print a human-readable help text and exit 0. |
| **FR-CLI-004** | `januscope` with no arguments MUST print help and exit 2. |

### 25.2 Minimal Mode

| ID | Requirement |
|---|---|
| **FR-CLI-005** | `januscope --target "<cmd>" [--block a,b,...] [--audit <path>]` MUST launch the proxy with the given target command, an optional comma-separated block list, and an optional audit sink, without requiring a config file. |
| **FR-CLI-006** | The target command string MUST be parsed using shell-like argument splitting (respecting quoted strings). |
| **FR-CLI-007** | Minimal mode MUST construct an equivalent in-memory `OverlayConfig` and route through the standard pipeline. |

### 25.3 Lens Subcommand

| ID | Requirement |
|---|---|
| **FR-CLI-008** | `januscope lenses` MUST be a subcommand namespace. |
| **FR-CLI-009** | `januscope lenses list` MUST print every bundled lens, one per line, with name, category, status, and "(stale)" annotation if applicable. |
| **FR-CLI-010** | `januscope lenses show <name>` MUST print the lens's `config.yaml` followed by its `README.md` (with frontmatter rendered as a header table). |
| **FR-CLI-011** | `januscope lenses search <query>` MUST print lenses whose name, tags, or frontmatter `mcp`/`description` contains `<query>` (case-insensitive). |
| **FR-CLI-012** | Unknown lens names MUST result in exit code 1 and a "lens not found; try `januscope lenses list`" message. |

### 25.4 Approve Subcommand

| ID | Requirement |
|---|---|
| **FR-CLI-013** | `januscope approve --config <path>` MUST recompute the static fingerprint and update (or create) the approval entry. |
| **FR-CLI-014** | The command MUST also probe the target (FR-PROBE-*) to capture and approve the live tools fingerprint. |
| **FR-CLI-015** | On success the command MUST print "approved: <config>" to stderr and exit 0. |

### 25.5 Behavior

| ID | Requirement |
|---|---|
| **FR-CLI-020** | All CLI parsing errors MUST exit 2 with a one-line error and a pointer to `januscope --help`. |
| **FR-CLI-021** | All stderr output from the CLI MUST be prefixed appropriately (`[januscope] ...`) so it is distinguishable from target output. |

---

## 26. Subsystem: Lens Validation Tool (FR-VAL)

**Script:** `scripts/validate-lenses.ts`

| ID | Requirement |
|---|---|
| **FR-VAL-001** | The tool MUST load every lens via the discovery module (FR-LENS-*). |
| **FR-VAL-002** | The tool MUST run the configuration loader's Zod validation against each lens's `config.yaml`. |
| **FR-VAL-003** | The tool MUST validate each README's frontmatter: required fields present, category/status are valid values. |
| **FR-VAL-004** | Default mode: structural validation only. Exit 0 if all lenses parse and frontmatter is valid; else exit 1 with a per-lens report. |
| **FR-VAL-005** | `--strict` mode: as default, plus fail if any lens has `isStale: true`. |
| **FR-VAL-006** | `--probe` mode: as default, plus for each lens, spawn the target (with credentials from env), run `tools/list`, and verify that every tool name referenced in the lens's `block`, `rateLimit`, `sqlGuard.tools`, `dbSchema.injectInto`, or `contextInjection.injectInto` exists in the live tool set. Missing references MUST fail the validation. |
| **FR-VAL-007** | Probe mode MUST honor per-lens timeout overrides via frontmatter `probeTimeoutMs`. |
| **FR-VAL-008** | The tool MUST exit 2 on unknown flags or bad invocation. |
| **FR-VAL-009** | The tool MUST emit a machine-readable summary (JSON) to stdout when invoked with `--json` for CI integration. |

---

## 27. Subsystem: Benchmark Tool (FR-BENCH)

**Script:** `scripts/bench-overhead.ts`

| ID | Requirement |
|---|---|
| **FR-BENCH-001** | The tool MUST spawn a fake MCP server (built-in NodeJS stub that returns canned responses). |
| **FR-BENCH-002** | The tool MUST run N tool calls (default 10,000; overridable via `--n`) through the full pipeline. |
| **FR-BENCH-003** | The tool MUST also run the same N calls with no overlays as a baseline. |
| **FR-BENCH-004** | The tool MUST report: median latency, p95 latency, p99 latency, memory delta (rss before/after), throughput (calls/sec) — for both the baseline and the loaded pipeline. |
| **FR-BENCH-005** | The tool MUST exit 0 if measurements complete; non-zero on harness failure. |
| **FR-BENCH-006** | Output MUST be plain-text human-readable by default; `--json` emits a structured object suitable for CI graphing. |

---

## 28. Cross-Cutting: Logging (FR-LOG)

| ID | Requirement |
|---|---|
| **FR-LOG-001** | All logs MUST be written to `stderr`. |
| **FR-LOG-002** | Log lines MUST be human-readable plain text by default. |
| **FR-LOG-003** | Log lines from overlays MUST be prefixed `[januscope:<overlay>]`. |
| **FR-LOG-004** | Log lines from core subsystems MUST be prefixed `[januscope:<subsystem>]`. |
| **FR-LOG-005** | The environment variable `JANUSCOPE_LOG_LEVEL` MAY override the default level: `error`, `warn`, `info` (default), `debug`, `trace`. |
| **FR-LOG-006** | The system MUST NOT emit any log line that contains raw credentials or secret values resolved via FR-SEC-*. |

---

## 29. Cross-Cutting: Error Handling (FR-ERR)

| ID | Requirement |
|---|---|
| **FR-ERR-001** | Every error path MUST produce an actionable, single-screen-readable message to stderr. |
| **FR-ERR-002** | Configuration errors MUST cite the file path and (when available) line/column. |
| **FR-ERR-003** | Spawn errors MUST clearly state the failed command and the OS-level error. |
| **FR-ERR-004** | Errors from any optional integration (Vault, AWS, OTel, DB drivers) MUST be presented as such and MUST NOT be mistaken for core failures. |
| **FR-ERR-005** | Uncaught exceptions in the message loop MUST be logged with stack trace and the affected message dropped — the loop MUST continue. |
| **FR-ERR-006** | Internal errors in gate overlays MUST always be returned to the client as `-32603 InternalError` per FR-PIPE-020. |

---

## 30. Non-Functional Requirements (NFR)

### 30.1 Performance

| ID | Requirement |
|---|---|
| **NFR-PERF-001** | Median per-message overhead added by the no-overlay pipeline MUST be ≤ 0.5 ms on a modern laptop. |
| **NFR-PERF-002** | Median per-message overhead added by a typical loaded pipeline (audit + block + sqlGuard + instructions) MUST be ≤ 2 ms. |
| **NFR-PERF-003** | p99 per-message overhead MUST be ≤ 10 ms under the same conditions. |
| **NFR-PERF-004** | The system MUST handle MCP messages up to 4 MB without crashing. (Larger messages MAY emit a warning.) |
| **NFR-PERF-005** | The SQL guard MUST cap the size of input it parses at 1 MB; oversized inputs MUST be rejected with a clear error. |

### 30.2 Security

| ID | Requirement |
|---|---|
| **NFR-SEC-001** | All file writes to `~/.januscope/` MUST use mode `0600` on Unix-like systems. |
| **NFR-SEC-002** | No log line MUST contain plaintext credentials, raw tokens, or resolved secret values. |
| **NFR-SEC-003** | Dependencies MUST be scanned weekly via Snyk (or equivalent); high-severity findings MUST be triaged within 7 days. |
| **NFR-SEC-004** | The shipped package MUST NOT include `.env` files, test fixtures with credentials, or local approval store. |

### 30.3 Compatibility

| ID | Requirement |
|---|---|
| **NFR-COMPAT-001** | Supported Node.js: ≥ 20.0.0. |
| **NFR-COMPAT-002** | Supported platforms: macOS (arm64, x64), Linux (x64, arm64), Windows (x64). |
| **NFR-COMPAT-003** | The package MUST be installable via `npm install -g januscope`. |
| **NFR-COMPAT-004** | The package MUST be invokable via `npx januscope` without prior installation. |

### 30.4 Maintainability

| ID | Requirement |
|---|---|
| **NFR-MAINT-001** | The TypeScript source MUST compile with `strict: true`. |
| **NFR-MAINT-002** | The codebase MUST pass `eslint` with zero errors. |
| **NFR-MAINT-003** | The codebase MUST pass `prettier --check` on every PR. |
| **NFR-MAINT-004** | Total source LOC SHOULD remain ≤ ~7,000 lines (excluding tests, lens YAML, and docs). |

### 30.5 Observability

| ID | Requirement |
|---|---|
| **NFR-OBS-001** | Boot summary MUST be present unless explicitly suppressed (FR-BOOT-003). |
| **NFR-OBS-002** | Audit log format MUST be stable across minor versions; any breaking change MUST bump the major version. |

### 30.6 Reliability

| ID | Requirement |
|---|---|
| **NFR-REL-001** | A malformed message from either side MUST NOT crash the process (FR-RPC-013, FR-TRANS-009). |
| **NFR-REL-002** | A failing observer overlay MUST NOT block traffic (FR-PIPE-021). |
| **NFR-REL-003** | A failing gate overlay MUST surface a clear error to the client (FR-PIPE-020). |

### 30.7 Usability

| ID | Requirement |
|---|---|
| **NFR-USE-001** | A new operator MUST be able to wrap a real MCP server with a sane policy in under 5 minutes, using a bundled lens. |
| **NFR-USE-002** | All CLI error messages MUST recommend the next user action (run `--help`, list lenses, approve config, etc.). |

---

## 31. Data Models

### 31.1 OverlayConfig (top-level)

```
OverlayConfig {
  target:      TargetSpec
  classification?: "public" | "internal" | "sensitive"
  firstRun?:   "approve"
  block?:      string[]
  instructions?: string | InstructionsConfig
  audit?:      AuditConfig
  dbSchema?:   DbSchemaConfig
  contextInjection?: ContextInjectionConfig
  redact?:     RedactConfig
  rateLimit?:  RateLimitRule[]
  sqlGuard?:   SqlGuardConfig
  telemetry?:  TelemetryConfig
}

TargetSpec {
  command: string
  args?:   string[]
  env?:    Record<string,string>
  cwd?:    string
}
```

### 31.2 AuditEvent (one NDJSON line)

```
AuditEvent {
  timestamp:        string (ISO 8601, UTC)
  type:             "startup" | "shutdown" |
                    "tools/call ok" | "tools/call error" |
                    "tools/call timeout" | "tools/call orphaned"
  lens_name?:       string
  lens_version?:    string
  classification?:  "public" | "internal" | "sensitive"
  user?:            string  // from JANUSCOPE_USER
  team?:            string  // from JANUSCOPE_TEAM
  session?:         string  // from JANUSCOPE_SESSION
  // tools/call events
  tool_name?:       string
  args_hash?:       string (hex SHA-256)
  args?:            unknown   // only if logRawArgs: true
  response_hash?:   string (hex SHA-256)
  outcome?:         "ok" | "error" | "timeout" | "orphaned"
  error_code?:      number
  error_message?:   string
  // startup/shutdown events
  reason?:          string
  exit_code?:       number
  duration_ms?:     number
}
```

### 31.3 ApprovalEntry (one record in approved.json)

```
ApprovalEntry {
  config_path:           string
  janus_version:         string
  approved_at:           string (ISO 8601)
  static_fingerprint:    string (hex SHA-256)
  static_sub_hashes: {
    target:      string
    block:       string
    sqlGuard:    string
    rateLimit:   string
    redact:      string
    classification: string
  }
  live_tools_fingerprint?: string (hex SHA-256)
  live_tools_approved_at?: string (ISO 8601)
}
```

### 31.4 LiveTool (from target probe)

```
LiveTool {
  name:           string
  description?:   string
  inputSchema?:   JSONSchema
  annotations?:   Record<string, unknown>
}
```

### 31.5 SchemaSnapshot (from DB introspection)

```
SchemaSnapshot {
  driver:    "postgres" | "mysql" | "sqlite"
  tables: Array<{
    schema?:     string
    name:        string
    comment?:    string
    columns: Array<{
      name:       string
      type:       string
      nullable:   boolean
      default?:   string
      comment?:   string
      isPrimary:  boolean
    }>
    foreignKeys: Array<{
      column:    string
      refTable:  string
      refColumn: string
    }>
    indexes:     Array<{ name: string, columns: string[], unique: boolean }>
    constraints: Array<{ name: string, kind: string, definition: string }>
  }>
}
```

### 31.6 Lens (from discovery)

```
Lens {
  dir:           string
  name:          string         // dir basename
  category:      LensCategory
  config:        OverlayConfig
  frontmatter:   LensFrontmatter
  readmeBody:    string
  isStale:       boolean
}

LensFrontmatter {
  mcp:            string
  mcpUrl?:        string
  testedVersion?: string
  testedAt?:      string (ISO date)
  maintainer?:    string
  category:       LensCategory
  status:         LensStatus
  tags?:          string[]
}
```

---

## 32. Acceptance Criteria

Each criterion is a Gherkin-style scenario referencing the requirement IDs it exercises. Conformance demands that every scenario passes.

### 32.1 Foundation

**AC-1 (FR-RPC-010..016)** — Given a stream that delivers a JSON-RPC message split across three TCP-sized chunks with a multi-byte UTF-8 character at the boundary, when the decoder runs to completion, then exactly one complete message MUST be emitted and the character MUST be intact.

**AC-2 (FR-TRANS-001..005)** — Given a config pointing at a working filesystem MCP, when `januscope --config` is launched, then the target child MUST be spawned with the merged env, JSON-RPC messages MUST flow in both directions, and `Ctrl+C` MUST terminate both processes cleanly.

**AC-3 (FR-PIPE-010..022)** — Given three overlays registered in order [A=observer, B=gate, C=observer] and B throws on a specific message, when that message arrives, then A MUST run, B's throw MUST short-circuit with `-32603`, and C MUST NOT run.

### 32.2 Config

**AC-4 (FR-CFG-005..015)** — Given a YAML config with `${MISSING_VAR}` and `${vault://path#field}`, when `loadConfig` (sync) is called, then it MUST refuse with a message recommending `loadConfigAsync`. When `loadConfigAsync` is called with the env unset, then the missing var MUST become empty string with a warning and vault MUST be resolved via the SDK.

### 32.3 Audit

**AC-5 (FR-AUDIT-010..030)** — Given a session that completes 5 successful `tools/call`s and 1 error, when the audit sink is inspected, then exactly 5 `tools/call ok` events MUST be present, 1 `tools/call error`, 1 `startup`, and 1 `shutdown` — each one a valid line per `schemas/audit-event.json`.

### 32.4 Block

**AC-6 (FR-BLOCK-003..005)** — Given `block: [admin_*]`, when the target returns `tools/list = [admin_delete, admin_create, namespace:admin_foo, query]`, then the response forwarded to the client MUST contain only `namespace:admin_foo` and `query`. When the client calls `admin_create`, the response MUST be `-32601`.

### 32.5 SQL Guard

**AC-7 (FR-SQL-030..052)** — Given `sqlGuard: { tools: [query], readOnly: true }`, when the client calls `query` with `SELECT 1; /* UPDATE users SET banned=true */ DROP TABLE x;`, then the call MUST be rejected with `-32602` citing the offending statement.

**AC-8** — Given the same config, when the client calls `query` with `SELECT * FROM users WHERE name = 'O''Brien -- not a comment'`, then the call MUST be allowed (string-literal content is not parsed as SQL).

### 32.6 Redact

**AC-9 (FR-RDCT-020..041)** — Given `redact: { rules: [{ field: "rows.**.password" }] }`, when the target returns a response with a deeply nested `password` field, then the response delivered to the client MUST have `password` replaced with `[REDACTED]`, while the audit overlay MUST have logged the un-redacted hash.

### 32.7 Schema Injection

**AC-10 (FR-SCHEMA-020..043)** — Given `dbSchema` pointed at a SQLite database with two tables `users` and `orders`, when the client calls `tools/list`, then each matching tool's description MUST contain a rendered schema (in the configured format) listing both tables.

### 32.8 Tool Surface Drift

**AC-11 (FR-DRIFT-002..007)** — Given `firstRun: approve` and an approved fingerprint, when the target on the next run adds a new tool `delete_all_users`, then the first `tools/list` response delivered to the client MUST be an error explaining the drift and instructing the operator to run `januscope approve`.

### 32.9 CLI

**AC-12 (FR-CLI-009..011)** — `januscope lenses list` MUST list every directory under `lenses/<category>/` with its parsed metadata. `januscope lenses search postgres` MUST find at least `postgres-crystaldba` and `neon-cloud`.

### 32.10 Validation

**AC-13 (FR-VAL-005)** — `npm run validate:lenses --strict` MUST exit non-zero in a synthetic test where one bundled lens has `testedAt` 8 months in the past.

---

## 33. Traceability Matrix

Each scope2 component maps to one or more FR groups. SCOPE.md section numbers cross-reference the engineering scope.

| scope2 Component | FR Groups | SCOPE.md Section |
|---|---|---|
| 1. Message-Routing Engine | FR-RPC | §4.1 |
| 2. Connection Bridge | FR-TRANS | §4.2 |
| 3. Pipeline Orchestrator | FR-PIPE | §4.3 |
| 4. Configuration Loader | FR-CFG | §4.4 |
| 5. Secret-Reference Resolver | FR-SEC | §4.5 |
| 6. First-Use Trust System | FR-QUAR | §4.6 |
| 7. Tool-Discovery Probe | FR-PROBE | §4.7 |
| 8. Telemetry Recorder | FR-TEL | §4.8 |
| 9. Startup Summary Display | FR-BOOT | §4.9 |
| 10. Config-File Discovery | FR-LENS | §4.10 |
| 11. Action Recorder (Audit) | FR-AUDIT | §5.1 |
| 12. Tool Blocker | FR-BLOCK | §5.2 |
| 13. DB Write Guard | FR-SQL | §5.3 |
| 14. Sensitive-Data Scrubber | FR-RDCT | §5.4 |
| 15. Policy Instructions Injector | FR-INST | §5.5 |
| 16. Rate Limiter | FR-RATE | §5.6 |
| 17. DB Schema Pre-Loader | FR-SCHEMA | §5.7 |
| 18. Custom Context Injector | FR-CTX | §5.8 |
| 19. Tool-Surface Drift Detector | FR-DRIFT | §5.9 |
| 20. Command-Line Tool | FR-CLI | §7 |
| 21. Config Validation Tool | FR-VAL | §12.2 |
| 22. Performance Benchmark Tool | FR-BENCH | §12.3 |
| 23. Test Suite | NFR-MAINT, AC-* | §11 |
| 24. Quality & Linting | NFR-MAINT-002..003 | §12.1 |
| 25. CI Pipeline | NFR-SEC-003, AC-* | §12.4 |
| 26. Security Scanning | NFR-SEC-003 | §12.1, §12.4 |
| 27. Lens Library | FR-LENS, FR-VAL | §8 |
| 28-40. Docs & Distribution | Out of scope of FRS (covered by deliverables list) | §13 |

---

## 34. Open Questions & Assumptions

### 34.1 Assumptions

- The upstream MCP protocol is stable enough that JanuScope's JSON-RPC envelope handling is forward-compatible. (Risk noted in scope2 §14.2.)
- Operators are responsible for the security of the audit sink file (permissions, retention, rotation). JanuScope creates the file with `0600` but does no rotation.
- The host machine has working DNS and outbound HTTPS when Vault/AWS/OTel are configured; failure modes are surfaced via clear errors, not retries.
- Approval store collision: two configs at the same path will share an entry; configs at different paths but with the same content are treated as different entries (path-keyed).

### 34.2 Open Questions

| # | Question | Default if unresolved |
|---|---|---|
| 1 | Should the approval store be keyed by config path or by config content hash? | Path-keyed (scope2 implies a per-file approval; revisit if multi-host sharing emerges). |
| 2 | Should rate-limit buckets persist across process restarts? | No — fresh per session (FR-RATE-021). |
| 3 | Should `dbSchema` support periodic refresh while a session is running? | No — `refresh: never` and `refresh: startup` only in MVP (FR-SCHEMA-009). |
| 4 | What is the maximum acceptable audit event size? | No hard cap in MVP; rely on disk space. |
| 5 | Should `--probe` mode in the validation tool require network access to remote MCPs (notion, atlassian)? | Yes, but failures of remote-only lenses MUST be reported separately from local lens failures. |
| 6 | Should there be a `--dry-run` mode that runs the full pipeline but never forwards messages to the target? | [POST-MVP]. |
| 7 | Should the system support more than one target MCP per JanuScope process? | No — one target per process; multiple targets require multiple processes (preserves the short-lived-process model from SCOPE §14.3). |

---

*End of functional requirements specification.*
