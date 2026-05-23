# Build Roadmap — MCP Policy Middleware (Commercial Product)

> A phased, opinionated build plan for creating a commercial MCP policy proxy in the same space as JanuScope. Written for: Node.js + TypeScript stack, commercial product positioning, open-ended timeline, builder familiar with MCP as a user but not as a developer.

---

## Table of Contents

1. [Honest Reality Check](#1-honest-reality-check)
2. [Phase 0 — Before You Write Any Code](#2-phase-0--before-you-write-any-code)
3. [Phase 1 — Minimum Viable Passthrough](#3-phase-1--minimum-viable-passthrough)
4. [Phase 2 — First Gate Overlay: Block](#4-phase-2--first-gate-overlay-block)
5. [Phase 3 — Config Layer](#5-phase-3--config-layer)
6. [Phase 4 — Audit (Commercial Moat)](#6-phase-4--audit-commercial-moat)
7. [Phase 5 — Security Overlays](#7-phase-5--security-overlays)
8. [Phase 6 — Output Processing](#8-phase-6--output-processing)
9. [Phase 7 — Differentiation Features](#9-phase-7--differentiation-features)
10. [Concrete Next 3 Actions](#10-concrete-next-3-actions)
11. [Honest Warnings](#11-honest-warnings)
12. [What to Ask Me Next](#12-what-to-ask-me-next)

---

## 1. Honest Reality Check

You're building a commercial product in the same niche as JanuScope (AGPL + commercial). Two things matter before anything else:

1. **You've never built an MCP server.** That gap has to close in the first week, or every architecture decision afterward will be guesswork.
2. **JanuScope already exists and is open source.** If you ship a clone, you lose. You need a defensible reason for customers to choose yours.

Everything below is shaped by those two facts.

---

## 2. Phase 0 — Before You Write Any Code

> Do this week. Do not skip.

### 2.1 Find Your Wedge (most important)

You must be able to answer this in one paragraph before writing code:

> *"My product wraps MCP servers and adds X. The customer is Y. They pay $Z/seat or $Z/team because they can't do this with JanuScope."*

Candidate wedges — pick one:

| Wedge | Why It Works |
|---|---|
| **Hosted / managed gateway** | JanuScope is local-only by design. A hosted version with team dashboards, shared policies, and central audit log retention is a different product, not a clone. |
| **Compliance-first** | SOC2 / HIPAA / PCI-ready out of the box: encrypted audit logs, retention guarantees, SIEM integration, formal threat model docs. Sells to enterprise security teams. |
| **Policy-as-code / GitOps** | Multi-team policy distribution: a control plane that pushes lens configs to many developer machines, versioned, approved via PR. JanuScope has no story here. |
| **AI-native overlays** | Prompt-injection detection on tool args, semantic redaction (LLM-based, not regex), cost/budget controls per tool. Goes beyond pattern matching. |
| **Industry vertical** | "Policy proxy for healthcare MCPs" or "for finance" — bundled compliance, vetted lenses, vendor support. Narrower TAM but defensible. |
| **Better DX for one platform** | Tight integration with one IDE (Cursor, VS Code) or one AI (Claude). UI for browsing audit logs, building lenses visually. |

**Decision matters.** A hosted product means a control plane + database from day one — totally different from JanuScope's "die when client disconnects" model. A compliance-first product means signed audit chains as Phase 1, not Phase 4.

### 2.2 Licensing Decision

JanuScope chose AGPL + commercial. Your options:

| Model | Examples | Tradeoff |
|---|---|---|
| **Closed source from day one** | Most commercial software | Full control; no community contributions. |
| **Open-core** (free MVP, paid features) | Cal.com, GitLab, PostHog | Builds community; clear paid features needed. |
| **Source-available** (BSL, Elastic License) | Sentry, MongoDB, HashiCorp | Code visible, can't be resold; medium-friction. |

This decision affects how you structure the repo from day one — a closed core with public lens library, vs. fully open.

### 2.3 Learn MCP By Building, Not Reading

You're an MCP user, not a builder. Spend 1–2 days building **a trivial MCP server** before you touch the proxy.

**Goals:**
- Write a stdio-based MCP server in TS that exposes one tool (e.g., `add_numbers`).
- Connect it to Claude Desktop and call it.
- Read the JSON-RPC frames going back and forth (log to a file).

Until you've seen real MCP frames with your own eyes, you'll get the proxy semantics wrong. Use `@modelcontextprotocol/sdk` (the official TS SDK) — it's well-documented.

---

## 3. Phase 1 — Minimum Viable Passthrough

> Week 1–2 of building. Goal: a binary that sits between your test MCP server and Claude Desktop, forwarding every byte unchanged, and Claude doesn't notice the difference.

**Files to write, in this order:**

1. **`src/rpc.ts`** — JSON-RPC types + `FrameDecoder` class (NDJSON, handles split UTF-8) + `encodeFrame`. Test with hand-crafted byte streams. See `scope3.md §6`.
2. **`src/transport/stdio.ts`** — `child_process.spawn` the target, wire `process.stdin → target.stdin` and `target.stdout → process.stdout`. See `scope3.md §7`.
3. **`src/pipeline.ts`** — Empty pipeline (overlay registry, but no overlays yet). Pass messages through. See `scope3.md §8`.
4. **`src/cli.ts`** — Accept `--target "<cmd>"` and that's it. Hardcode everything else.

**Acceptance test:** Configure Claude Desktop to call your binary instead of an MCP server. It should work identically.

This is your "hello world." Until this is rock solid, no overlay will work right.

---

## 4. Phase 2 — First Gate Overlay: Block

> Week 2–3. The simplest useful overlay. Cement the `Overlay` interface here — every other overlay will follow the same shape.

**Files:**

- **`src/overlays/_shared.ts`** — glob matcher (`*` matches except `_`), helpers for extracting tool names from `tools/list` and `tools/call`.
- **`src/overlays/block.ts`** — filter `tools/list` responses, short-circuit `tools/call` for blocked names.

By the end of Phase 2 you have something **actually useful**: drop dangerous tools from any MCP server with a 3-line config. This is also the first thing you can demo.

---

## 5. Phase 3 — Config Layer

> Week 3.

- **`src/config.ts`** — YAML loading, Zod validation, env-var substitution, path normalization. See `scope3.md §9`.
- Switch CLI to `--config <path>`.

Skip secrets backends for now — that's Phase 7+.

---

## 6. Phase 4 — Audit (Commercial Moat)

> Week 4. *This is where commercial differentiation begins.*

For a commercial product, **audit is your moat, not block.** Anyone can write a `block` overlay in 50 lines. Audit done well — SIEM-friendly, tamper-evident, queryable — is what compliance officers pay for.

**Files:**

- **`src/overlays/audit.ts`** — NDJSON sink, fire-and-forget writes, identity fields from env, args hashing.
- **`schemas/audit-event.json`** — JSON Schema for the event format.

**If your wedge is "compliance-first," go deeper here than JanuScope does:**

- **Signed audit lines** — HMAC chain so tampering is detectable. Each line includes the hash of the previous line.
- **Optional encrypted-at-rest writes** — symmetric encryption with a key from env/KMS.
- **Built-in SIEM forwarders** — Splunk HEC, Datadog Logs, Elastic Common Schema mapping.
- **Retention policies** — auto-rotate, max-size, optional S3 archival.

---

## 7. Phase 5 — Security Overlays

> Weeks 5–6. In this order:

1. **`src/overlays/instructions.ts`** — easiest, builds confidence in `tools/list` mutation.
2. **`src/overlays/sqlGuard.ts`** — start with allowlist mode, then add comment stripping and string-literal blanking. **Test against actual evasion attempts** (see `scope3.md §18.6`).
3. **`src/overlays/rateLimit.ts`** — token buckets, per-tool isolation.

---

## 8. Phase 6 — Output Processing

> Week 7.

- **`src/overlays/redact.ts`** — regex first, then field paths with `*`/`**` wildcards, then apply modes.

**Critical:** deep-clone the response before mutating, so audit sees the un-redacted version. See `scope3.md §19.5`.

---

## 9. Phase 7 — Differentiation Features

> Week 8+. Now you diverge from JanuScope based on your wedge.

### If your wedge is **hosted**
Build a control plane: database, web UI, policy distribution mechanism, central audit log search. This is a whole separate product — likely a Postgres + Next.js stack alongside the proxy binary.

### If your wedge is **compliance**
- Signed audit chains (HMAC-linked NDJSON).
- SOC2 evidence pack generators (auto-rendered control reports).
- Configurable retention policies.
- Formal threat model document.

### If your wedge is **GitOps**
- Lens config versioning.
- PR-based approval workflows.
- Drift detection across a fleet of operators.
- Per-team policy override hierarchy.

### If your wedge is **AI-native**
- Integrate with Claude / GPT for semantic redaction.
- Prompt-injection scoring on tool args.
- Per-tool token / cost budgets.

JanuScope's other overlays (`dbSchema`, `contextInjection`, `toolSurface`, `quarantine`) can come later — they're table stakes once you have a commercial story.

---

## 10. Concrete Next 3 Actions

> Do these this week.

### Action 1 — Decide your wedge

Write one paragraph in this file (or a sibling `WEDGE.md`):

> *"My product wraps MCP servers and adds X. The customer is Y. They pay $Z/seat or $Z/team because they can't do this with JanuScope."*

Do not proceed past this until the paragraph is written and feels defensible.

### Action 2 — Build a toy MCP server

- Install `@modelcontextprotocol/sdk`.
- Expose one tool (e.g., `add_numbers`).
- Connect to Claude Desktop, call the tool, see it work.
- Log every JSON-RPC frame to a file. Read the file.

**Goal:** lose your fear of the protocol.

### Action 3 — Set up the repo

- `pnpm init`, TypeScript with `strict: true`, Vitest, ESLint, Prettier.
- Decide license. Push to a private repo if commercial.
- Lay out the directory skeleton mirroring `scope3.md §31` data models.
- Add a `Makefile` or `package.json` scripts so `pnpm run dev` spawns your binary in watch mode.

---

## 11. Honest Warnings

- **JanuScope is good.** Read its source when it's available. You won't beat it on features in 3 months. You beat it on positioning, polish, or scope (hosted, vertical, integrated).
- **MCP is moving fast.** The protocol gets revisions. Don't over-invest in handling edge cases of MCP v0.x that may not exist in v1.
- **Stdio is the easy transport.** SSE / HTTP transports are coming — design your pipeline so swapping transports is a one-file change.
- **Tests matter early.** This is a security-critical proxy. Bugs in the SQL guard or redact overlay could leak customer data. Write tests as you build, not after.
- **Audit is the moat.** Don't undervalue it. Most security teams will pay for audit alone if it's good enough.
- **Don't over-engineer Phase 1.** A working passthrough proxy is more valuable than a half-built pipeline. Get the boring foundations rock-solid before reaching for overlays.

---

## 12. What to Ask Me Next

Once you've worked through Phase 0, come back with one of:

- **"Help me define my wedge."** — work through positioning, pricing, ICP.
- **"Walk me through building the toy MCP server."** — step-by-step Phase 0.3.
- **"Sketch the directory structure and package.json."** — Phase 1 scaffolding.
- **"Design the control plane architecture."** — if you choose the hosted wedge.
- **"Help me write tests for the FrameDecoder."** — once Phase 1 starts.

---

*End of roadmap. Keep this document open as you work — revisit it weekly and check off phases as they're complete.*
