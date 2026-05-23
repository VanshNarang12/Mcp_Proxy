# JanuScope — Project Scope & Requirements Document

> A plain-English requirements document describing every component of the project, what each one does, and why it is needed. This document contains no code, no technical configuration, and no implementation detail — it is intended for product managers, stakeholders, decision-makers, and anyone who needs to understand the project's purpose and feature set before approving or planning a build.

---

## Table of Contents

1. [Background & Problem Statement](#1-background--problem-statement)
2. [What the Product Is](#2-what-the-product-is)
3. [Target Users](#3-target-users)
4. [Business Goals](#4-business-goals)
5. [Component Inventory — Overview](#5-component-inventory--overview)
6. [Core Components in Detail](#6-core-components-in-detail)
7. [Security & Policy Components in Detail](#7-security--policy-components-in-detail)
8. [Operational Components in Detail](#8-operational-components-in-detail)
9. [Pre-Built Configuration Library](#9-pre-built-configuration-library)
10. [Documentation & Support Components](#10-documentation--support-components)
11. [Distribution & Release Components](#11-distribution--release-components)
12. [Success Criteria](#12-success-criteria)
13. [Out-of-Scope](#13-out-of-scope)
14. [Risks & Assumptions](#14-risks--assumptions)
15. [Glossary](#15-glossary)

---

## 1. Background & Problem Statement

### 1.1 The Background

In the last two years, AI assistants (Claude, Cursor, GitHub Copilot, Windsurf, and others) have become deeply integrated into the daily work of engineers, data analysts, and operations teams. These assistants no longer just suggest code — they can take real actions on real systems. They can run database queries, modify files, open pull requests, send messages, and call internal APIs.

The technology that makes this possible is a recently introduced open standard called the **Model Context Protocol (MCP)**. MCP lets an AI assistant connect to "MCP servers," each of which exposes a set of capabilities (called "tools") that the assistant can use. There are now hundreds of MCP servers — for databases, code repositories, productivity tools, cloud platforms, and almost every common business system.

### 1.2 The Problem

The convenience of letting an AI assistant act on real systems comes with serious, unmanaged risks:

| Risk | Real-World Consequence |
|---|---|
| The AI can call destructive operations | "Drop this table," "delete this branch," "remove these files" — all valid tool calls today |
| There is no record of what the AI did | If something goes wrong, there is no audit trail. Teams cannot answer "what query did the AI run last Tuesday at 3 PM?" |
| Sensitive data flows freely back to the AI | Customer emails, social security numbers, API keys — anything in the database can end up in the AI's context, potentially logged or cached by the AI provider |
| The AI burns tokens (and money) on discovery | Every session, the AI must "discover" what tables exist, what columns they have, what the API looks like. This wastes time, money, and degrades response quality |
| No rate limits on the AI's actions | An AI in a loop can hammer a database thousands of times in a minute, causing outages or huge bills |
| MCP servers can change silently | A trusted MCP server can ship an update with new, dangerous tools — and the AI will happily use them without warning anyone |
| Compliance teams have nothing to inspect | There is no standard log format, no policy layer, no place to wire SIEM (security information and event management) tooling |

In short: **MCP gives AI assistants real power but no guardrails.** Today, every company connecting an AI to its data systems is exposed to all of the above. There is no shared, off-the-shelf solution.

### 1.3 The Opportunity

A "policy layer" that sits between any AI assistant and any MCP server — and applies guardrails defined in a single, readable configuration file — would solve every problem listed above without requiring changes to either the AI assistant or the MCP server. This is the opportunity the project addresses.

---

## 2. What the Product Is

### 2.1 One-Sentence Description

**JanuScope is a local security and policy layer that wraps any AI tool server with guardrails — audit logs, access controls, data redaction, and rate limits — defined in a single configuration file.**

### 2.2 Plain-English Analogy

Think of an AI assistant as an intern with access to your company's databases and tools. JanuScope is the policy handbook, the security badge reader, the camera in the room, and the supervisor reviewing actions — all rolled into one. It does not stop the intern from working; it just ensures they only do what they are allowed to do, that everything they do is recorded, and that sensitive information stays out of their hands when it should.

### 2.3 How It Fits Into a Real Workflow

Today:

```
AI Assistant  -->  MCP Server  -->  Real System (database, files, GitHub, etc.)
```

With JanuScope:

```
AI Assistant  -->  JanuScope  -->  MCP Server  -->  Real System
                       |
                       v
                   Audit Log
```

JanuScope sits in the middle, invisible to both sides, applying policy and logging every action. Neither the AI nor the MCP server needs to change.

### 2.4 Key Properties Stakeholders Should Know

| Property | What It Means in Practice |
|---|---|
| **Runs entirely on the user's own computer** | No data ever leaves the operator's machine because of JanuScope. No cloud service, no third-party data flow. |
| **No central server or account required** | There is nothing to provision, no contract, no logins. It is a small program, not a platform. |
| **Single configuration file** | One YAML file defines all the rules. Easy to review, version-control, and share. |
| **Wraps anything** | Works with any MCP server — official, community, or in-house — without modifying it. |
| **Open source with optional commercial license** | The product is free under an open-source license; companies that need different terms can purchase a commercial license. |

---

## 3. Target Users

The product serves several distinct user types. Each cares about different components for different reasons.

### 3.1 Individual Developer

Wants the AI assistant to be safer and smarter when working with their own databases and code. Cares most about: schema injection, blocking destructive tools, simple setup.

### 3.2 Team Lead / Engineering Manager

Wants visibility into how their team's AI tools interact with shared systems. Cares most about: audit logging, rate limits, classification labels.

### 3.3 Security & Compliance Officer

Needs to satisfy auditors and regulators that AI usage is governed. Cares most about: audit log format, PII redaction, drift detection, threat model documentation.

### 3.4 Platform / DevOps Engineer

Wants to roll out a standard, repeatable policy across many teams. Cares most about: pre-built configurations (lenses), secret management, telemetry, validation tooling.

### 3.5 Open-Source Maintainer of an MCP Server

Wants their MCP server to be usable in serious production environments. Cares most about: pre-built lens for their server, schema injection, the policy framework.

---

## 4. Business Goals

The product exists to achieve these outcomes:

| Goal | Measure of Success |
|---|---|
| Make AI-on-data safe enough for production use | Users can deploy AI assistants in environments handling sensitive data with documented controls |
| Eliminate the AI tax of schema discovery | Token usage and response time measurably reduced compared to bare AI-MCP integration |
| Provide a paper trail for every AI action | Audit log captures 100% of tool calls in a format compatible with standard security tooling |
| Be the default policy layer for MCP | Adoption across a wide range of MCP servers; the project ships pre-built configurations for the most popular ones |
| Be operable by individuals, not just enterprises | Setup takes minutes, not days; no infrastructure required |

---

## 5. Component Inventory — Overview

The project consists of **40 distinct components**, grouped into five categories:

### Core Components (10)
The foundational machinery that makes the policy proxy work.

1. Message-Routing Engine
2. Connection Bridge to AI Tool Servers
3. Policy Pipeline Orchestrator
4. Configuration Loader
5. Secret-Reference Resolver
6. First-Use Trust System
7. Tool-Discovery Probe
8. Telemetry Recorder
9. Startup Summary Display
10. Configuration-File Discovery System

### Security & Policy Components (9)
The individual policy modules that operators turn on and off in their configuration.

11. Action Recorder (Audit Log)
12. Tool Blocker
13. Database Write Guard
14. Sensitive-Data Scrubber
15. Policy Instructions Injector
16. Rate Limiter
17. Database Schema Pre-Loader
18. Custom Context Injector
19. Tool-Surface Drift Detector

### Operational Components (7)
The user-facing tools that make the product practical to use day-to-day.

20. Command-Line Tool
21. Configuration Validation Tool
22. Performance Benchmark Tool
23. Test Suite
24. Quality & Linting Tooling
25. Continuous Integration Pipeline
26. Security Scanning Setup

### Pre-Built Configuration Library (1 component, 20 entries)

27. Lens Library

### Documentation & Distribution Components (13)

28. User Manual (README)
29. Architecture Document
30. Security Document
31. Contribution Guide
32. Code of Conduct
33. Support Document
34. Change Log
35. Contributor License Agreement
36. Open-Source License
37. Commercial License
38. MCP Registry Metadata
39. Quick-Start Configuration Snippet
40. Directory Listing Metadata

---

## 6. Core Components in Detail

> The components in this section are the engine of the product. End users do not interact with them directly, but everything else in the product depends on them.

### Component 1 — Message-Routing Engine

**What it is**

The piece of software that understands the language AI assistants and tool servers use to talk to each other (a standard called JSON-RPC). It reads incoming messages, identifies them as requests, responses, or notifications, and routes them appropriately.

**Why it is needed**

Without this component, JanuScope cannot understand what is being said in either direction. Every other component — every audit log, every block, every redaction — depends on the engine being able to recognize, parse, and re-emit messages cleanly.

**What value it delivers**

It enables JanuScope to be transparent: AI assistants and MCP servers connected through JanuScope behave exactly as they would in a direct connection, only with the added policy layer.

---

### Component 2 — Connection Bridge to AI Tool Servers

**What it is**

The component that launches the upstream MCP server as a child program when JanuScope starts, then connects the AI assistant's input and output streams to the upstream server through the policy layer. When the AI assistant disconnects, this component cleanly shuts down the upstream server.

**Why it is needed**

The AI assistant expects to talk directly to a tool server. JanuScope needs to "pretend to be" that tool server while actually running the real one underneath. This component performs that handoff.

**What value it delivers**

Operators can drop JanuScope into their existing setup without changing anything else. The AI assistant config now points to JanuScope; JanuScope's config points to the real tool server. No other change is required.

---

### Component 3 — Policy Pipeline Orchestrator

**What it is**

The conductor that, for every message flowing between the AI assistant and the tool server, walks through every active policy module in the right order and gives each one a chance to inspect, modify, log, or block the message.

**Why it is needed**

Policy enforcement only works if every module is applied consistently and in a predictable order. Without an orchestrator, modules would fight each other or miss messages. The orchestrator also enforces critical safety rules: security modules ("gates") refuse to let messages through if they fail, while informational modules ("observers") never block traffic.

**What value it delivers**

It gives operators confidence that the policy they wrote in their configuration file is exactly the policy applied at runtime — every message, in order, with predictable failure behavior.

---

### Component 4 — Configuration Loader

**What it is**

The component that reads the operator's YAML or JSON configuration file, fills in any placeholders that reference environment variables or secret stores, validates that every section is well-formed, and produces the in-memory configuration the rest of the system uses.

**Why it is needed**

The configuration file is the single source of truth for what JanuScope does in any given session. If it is malformed, the system must refuse to start, with a clear and actionable error message. Operators must never be left guessing why something is not working.

**What value it delivers**

Operators get fast, helpful feedback if their configuration is wrong. Sensitive values (passwords, API keys) never need to be written into config files — they can be referenced safely from environment variables or vaults.

---

### Component 5 — Secret-Reference Resolver

**What it is**

A component that recognizes special placeholders in the configuration file pointing at HashiCorp Vault, AWS Secrets Manager, or 1Password, and fetches the actual secret values at startup time.

**Why it is needed**

Configuration files often live in source control. Putting plain-text passwords or API keys in source control is a serious security violation. The Resolver lets operators reference secrets without ever exposing them in the configuration file itself.

**What value it delivers**

Configurations are safe to commit to git and share with teammates. Secret rotation in Vault or AWS automatically takes effect on the next session — no config edits needed.

---

### Component 6 — First-Use Trust System

**What it is**

A safety system that, on the first time an operator runs a particular configuration, records a "fingerprint" of (a) the configuration itself and (b) the set of tools the upstream tool server exposes. On subsequent runs, it compares the current fingerprint to the saved one. If anything has changed unexpectedly, JanuScope refuses to start until the operator explicitly approves the change.

**Why it is needed**

There are two distinct threats this system addresses:

1. **Drift in the operator's own policy.** Someone on the team quietly weakens a block list or disables a rate limit. The Trust System notices and demands re-approval.
2. **A compromised or auto-updated tool server.** An upstream MCP server adds a dangerous new tool, removes a guardrail, or starts behaving unexpectedly. The Trust System catches this before the AI ever sees the new surface.

**What value it delivers**

Operators get a continuous, automatic sanity check. They cannot accidentally run with weakened policy, and they cannot be silently betrayed by an upstream tool server.

---

### Component 7 — Tool-Discovery Probe

**What it is**

A utility that connects to a tool server, asks it to list all the tools it offers, and reports back what was discovered. It does not run any tool — only discovery.

**Why it is needed**

Several other components need to know what tools a server exposes:
- The Trust System needs the tool list to compute its fingerprint
- The Configuration Validation Tool needs it to verify that the operator's policy actually matches the tools available
- Operators need it to discover what they are wrapping

**What value it delivers**

Operators can verify their setup before connecting an AI assistant. They can confirm exactly what surface they are exposing, and re-approve changes deliberately.

---

### Component 8 — Telemetry Recorder

**What it is**

An optional component that emits operational metrics — timings, counts, error rates — in a standard format called OpenTelemetry. When enabled, these metrics flow to whatever observability platform the operator has chosen (Grafana, Honeycomb, Datadog, etc.).

**Why it is needed**

For platform teams running JanuScope across many users, raw audit logs are not enough. They need aggregate dashboards, alerting on latency spikes, and trend analysis. OpenTelemetry is the industry standard for this kind of data, supported by every major observability vendor.

**What value it delivers**

Platform teams can monitor JanuScope alongside their existing systems without learning a new tool. Individual users who do not enable telemetry pay zero performance overhead.

---

### Component 9 — Startup Summary Display

**What it is**

A short, human-readable banner that JanuScope prints to the operator's terminal when it starts up, summarizing what policies are active for the session: which tool server is being wrapped, which guardrails are on, where audit logs are going, what classification level applies.

**Why it is needed**

Operators need a quick visual confirmation that their configuration is loaded correctly. Without this, mistakes (like accidentally running with no policies active) are silent and easy to miss.

**What value it delivers**

Operators see exactly what policies are in force every time they start a session — like a "armed/disarmed" indicator on an alarm system.

---

### Component 10 — Configuration-File Discovery System

**What it is**

A small utility that helps users find and use the pre-built configuration files (called "Lenses") that ship with the product. It can list all available lenses, search them by name or category, show the details of a specific lens, and identify ones that are out of date.

**Why it is needed**

The product ships with a library of ready-to-use configurations for popular tool servers. Without a discovery system, users would have to manually browse the file system to find what's available.

**What value it delivers**

Users can start protecting any of 20 popular MCP integrations within minutes of installing the product — no need to write a configuration from scratch.

---

## 7. Security & Policy Components in Detail

> These are the components that operators turn on and off in their configuration file. Each one is independent — operators can mix and match to fit their use case. All nine are designed to be useful on their own; combining them produces "defence in depth."

### Component 11 — Action Recorder (Audit Log)

**What it is**

A logging system that records, in a structured machine-readable format, every meaningful event that happens in a session: when JanuScope starts, when the AI assistant calls a tool (with success, error, or timeout outcome), when the session ends. Each record includes the time, the tool name, the outcome, and optional fields for the operator's identity, team, and session.

**Why it is needed**

This is the single most important component for compliance, security investigations, and operational debugging. Without it, AI activity is invisible. Auditors cannot verify controls; security teams cannot investigate incidents; engineering teams cannot diagnose problems.

**What value it delivers**

- **For compliance**: A complete, tamper-evident record that AI usage is governed
- **For security**: Incident response can answer "what did the AI do?" instantly
- **For engineering**: A precise timeline of every call, enabling fast debugging

The format chosen is widely supported by security tools (SIEMs), so the logs slot straight into existing infrastructure.

---

### Component 12 — Tool Blocker

**What it is**

A simple, sharp filter. The operator lists tools by name (with optional wildcards like "admin_*"). The Blocker silently removes those tools from the list the AI assistant sees, and if the AI somehow tries to call one anyway, refuses the call with a polite error.

**Why it is needed**

Many tool servers expose a mix of safe and dangerous capabilities. Operators often want to allow the safe ones and remove the dangerous ones entirely. The Blocker is the bluntest, most reliable way to do that.

**What value it delivers**

Operators do not have to trust the AI's judgement about which tools to call. Dangerous tools simply do not exist from the AI's perspective. This is a far stronger guarantee than relying on prompt instructions.

---

### Component 13 — Database Write Guard

**What it is**

A specialized inspector that watches for tool calls containing SQL statements. It reads the actual SQL, ignoring tricks like comments and string literals designed to hide the intent, and refuses any statement that would modify data. By default, only read-only operations are allowed; write operations (UPDATE, DELETE, INSERT, DROP, etc.) are blocked at the proxy.

**Why it is needed**

Many database MCP servers expose a single, omnipotent tool called "execute_sql" or "query." The Tool Blocker (Component 12) cannot help here — the operator wants to allow the tool, just constrain what queries flow through it. The Database Write Guard provides this fine-grained constraint.

**What value it delivers**

Operators can give AI assistants safe, useful access to production databases without risk of data being modified. The Guard is robust against evasion attempts (hiding writes in comments, using unusual whitespace, splitting statements).

---

### Component 14 — Sensitive-Data Scrubber

**What it is**

A component that examines responses coming back from the tool server and removes or masks sensitive data before the AI assistant sees it. Operators can configure patterns to scrub (such as "anything matching a social security number format") or specific data fields (such as "always redact the 'password' field, wherever it appears").

**Why it is needed**

Even if the AI is allowed to query a database, the results often contain data that should never be exposed to the AI's context window: emails, phone numbers, government IDs, passwords, financial information. Once that data is in the AI's context, it may end up in:

- The AI provider's logs
- A future training data set
- Cached responses
- A screenshot or transcript shared by the user

The Scrubber stops that data from ever leaving the operator's machine.

**What value it delivers**

A defensible answer to the question "does our use of AI expose customer data?" — namely, "no, here are the redaction rules and the audit log proves they are enforced."

---

### Component 15 — Policy Instructions Injector

**What it is**

A component that adds operator-defined instructions to the descriptions of tools the AI assistant sees. For example, an operator can prepend the text "All queries must be read-only and must aggregate results" to every database tool's description.

**Why it is needed**

The first line of defence is shaping what the AI even tries to do. Modern AI models pay close attention to tool descriptions and instructions. By putting policy in the tool description itself, operators reduce the number of disallowed actions the AI even attempts.

**What value it delivers**

- Fewer policy refusals at the gate layer (because the AI does not try the forbidden action in the first place)
- A natural place to put data-classification banners ("SENSITIVE: PII / aggregate before returning")
- An on-ramp for organizations to communicate domain knowledge to the AI consistently across all sessions

---

### Component 16 — Rate Limiter

**What it is**

A component that limits how often a tool can be called in a given time window. Operators specify rules like "tool X may be called at most 60 times per minute" or "any tool starting with admin_ may be called at most 5 times per minute."

**Why it is needed**

AI assistants in error loops or tasked with very broad questions can issue hundreds or thousands of tool calls in a short period. This causes:

- Performance problems for the underlying system (database overload)
- Significant unexpected costs (per-query API charges)
- Trigger of upstream rate limits, which can affect other systems
- A noisy, hard-to-debug audit log

The Rate Limiter is the safety valve.

**What value it delivers**

Operators sleep better knowing that no single AI session can run away with their budget or take down their database, no matter what happens upstream.

---

### Component 17 — Database Schema Pre-Loader

**What it is**

A component that, when JanuScope starts, connects to a database, reads out all of its tables and columns, formats this information cleanly, and inserts it into the descriptions of database query tools the AI sees. The AI thereby starts every session with full knowledge of the database structure already in hand.

**Why it is needed**

Without this component, every AI session begins with the same wasteful ritual: "What tables are there? Now show me the columns of this table. Now show me the columns of that table." Each step costs tokens, time, and money. Worse, the AI sometimes does not discover the right tables and writes incorrect queries.

**What value it delivers**

Measured against a baseline of bare AI-to-MCP integration, this component alone delivers an estimated **84% reduction in tokens used** and roughly **3× faster** response times across realistic multi-question sessions. The AI is also more accurate because it sees the full schema up front.

This is the component that turns JanuScope from "a safety wrapper" into "a measurable productivity improvement."

---

### Component 18 — Custom Context Injector

**What it is**

A simpler cousin of the Database Schema Pre-Loader. Instead of querying a live database, it lets operators write any static context they like — a glossary of project terms, a list of allowed values, a directory tree, business rules — and inject it into tool descriptions. The text can be inline in the configuration or loaded from an external file.

**Why it is needed**

Not every context the AI needs comes from a database. Some lives in operators' heads:
- "Our 'status' field can only be ACTIVE, PENDING, or ARCHIVED."
- "Code lives under /src; tests live under /test."
- "Customer names use this naming convention."

The Custom Context Injector is the catch-all for this kind of context.

**What value it delivers**

Operators get the same productivity benefit as the Schema Pre-Loader for any domain they choose to describe — not just databases.

---

### Component 19 — Tool-Surface Drift Detector

**What it is**

A real-time companion to the First-Use Trust System (Component 6). It watches the very first response the tool server gives describing its available tools, compares it against the approved baseline, and refuses to continue if anything important has changed.

**Why it is needed**

Tool servers — especially ones installed via package managers — can update silently. An update could add a new dangerous tool, change a tool's description in a misleading way, or change what arguments a tool accepts. Without drift detection, an operator might be running a version of a tool server that materially differs from what they originally approved.

**What value it delivers**

Operators get peace of mind that an upstream change cannot silently expand or degrade the AI's capabilities. Any meaningful change pauses the session until a human re-approves.

---

## 8. Operational Components in Detail

> These components are the user-facing tools and processes that make the product practical to use, maintain, and trust.

### Component 20 — Command-Line Tool

**What it is**

The single command (`januscope`) that operators run to launch a session or perform administrative actions. It supports several modes:

- **Run mode**: launch a session using a configuration file
- **Minimal mode**: launch a session with simple flags, no configuration file needed
- **Lenses mode**: list, search, and inspect the pre-built configurations
- **Approve mode**: re-baseline the trust system after a deliberate change
- **Help & version**: standard utilities

**Why it is needed**

The command-line is the operator's primary interface to the product. It needs to be ergonomic, predictable, and have clear error messages. Every supported workflow should be accessible without writing code.

**What value it delivers**

A polished, scriptable interface that fits naturally into how engineers already work — pipelines, shells, CI scripts, terminal-based AI clients.

---

### Component 21 — Configuration Validation Tool

**What it is**

A separate utility (run via a script command) that examines every pre-built configuration shipped with the product and reports any that:

- Have invalid syntax
- Have missing or wrong metadata
- Are out of date (not re-tested in 6+ months)
- Reference tools that no longer exist on the upstream server (when run in "live probe" mode)

**Why it is needed**

The product ships with a library of pre-built configurations. As the underlying tool servers evolve, configurations can drift out of compatibility. Without a validation tool, the library would silently rot. With it, maintainers can confidently say "every configuration shipping in this release is known good."

**What value it delivers**

Trust in the configuration library: when a user picks a pre-built configuration, it works.

---

### Component 22 — Performance Benchmark Tool

**What it is**

A utility that measures how much overhead the policy layer adds to message flow. It spawns a synthetic tool server, runs many calls through the full pipeline, and reports timing and memory statistics.

**Why it is needed**

A policy proxy is only acceptable if its overhead is negligible. Without continuous measurement, a careless change could double the latency of every AI session, and nobody would notice until users complained.

**What value it delivers**

Confidence that JanuScope is not slowing anyone down. Every release can be measured and regressions caught before users experience them.

---

### Component 23 — Test Suite

**What it is**

A comprehensive automated test suite covering every component of the product, run on every code change. The suite includes:

- Unit tests for each component
- Integration tests where multiple components work together end-to-end
- Tests for edge cases and known attack patterns (e.g., attempts to evade the Database Write Guard with creative SQL)
- Tests requiring no external systems (e.g., the Schema Pre-Loader is tested against in-memory databases)

**Why it is needed**

The product is in the security-critical path between AI and real data. A bug could cause a real incident — leaked customer data, dropped tables, untraceable AI actions. A strong test suite is the only way to ship changes confidently.

**What value it delivers**

- Faster, safer development
- A clear safety net for contributors
- Visible quality signal for evaluators and users (test coverage is a proxy for project health)

---

### Component 24 — Quality & Linting Tooling

**What it is**

Automated style checks (Prettier), code-quality checks (ESLint), and type checks (TypeScript) run on every code change.

**Why it is needed**

Consistency makes code easier to read, review, and maintain. Type checking catches whole classes of bugs before runtime. Style and quality enforcement keep technical debt low without requiring per-PR debates.

**What value it delivers**

A consistent, professional, easy-to-onboard codebase. New contributors do not have to learn implicit style rules.

---

### Component 25 — Continuous Integration Pipeline

**What it is**

A set of automated workflows that run on every code change submitted to the project. They run the test suite, the quality checks, the configuration validation, and security scans. If any fails, the change cannot be merged.

**Why it is needed**

Without continuous integration, quality problems and security issues accumulate silently between releases. With it, every change is verified before it lands.

**What value it delivers**

Releases are predictable. The state of the main branch is always known-good. Reviewers can focus on logic rather than basic correctness.

---

### Component 26 — Security Scanning Setup

**What it is**

Automated vulnerability scanning of the project's dependencies (using a tool called Snyk). It flags any dependency with a known security issue and provides upgrade guidance.

**Why it is needed**

The product depends on third-party libraries. Any of them could have a vulnerability disclosed at any moment. Without scanning, the project would be unable to react quickly. With scanning, vulnerabilities are surfaced as soon as they are public.

**What value it delivers**

A documented, ongoing security posture. Compliance teams can point to active scanning as evidence of due diligence.

---

## 9. Pre-Built Configuration Library

### Component 27 — Lens Library

**What it is**

A curated library of 20 ready-to-use configurations, each one tailored to a specific popular tool server. Each entry in the library consists of:

- The configuration file itself, with sensible defaults and policy choices
- A documentation page explaining what the configuration does, what the upstream server is, who maintains the configuration, and when it was last tested

The 20 configurations cover:

**Databases (11 configurations)**

1. PostgreSQL (community implementation)
2. MySQL (community implementation)
3. MongoDB (official)
4. ClickHouse (official)
5. Redis (official)
6. SQLite (community implementation)
7. Snowflake (official)
8. Neon (cloud Postgres)
9. Amazon Redshift
10. Amazon Aurora DSQL
11. Oracle Database

**Developer Tools (2 configurations)**

12. GitHub (official)
13. Filesystem (reference implementation)

**SaaS Platforms (7 configurations)**

14. Stripe (official)
15. Notion (official, hosted)
16. Atlassian (official, hosted)
17. Linear (official, hosted)
18. Supabase Cloud (hosted)
19. Supabase Self-Hosted
20. Microsoft SQL Server / Azure SQL

Each configuration is also tagged with a status:

- **Probed** — recently live-tested against the actual tool server
- **Active** — maintained and documented, recent
- **Unverified** — configuration parses, looks correct against docs, but no live test (typically because the maintainer lacked credentials)
- **Stale** — has not been re-tested in over 6 months; flagged automatically
- **Archived** — the underlying tool server is retired; kept for historical reference

**Why it is needed**

Without a pre-built library, every user would have to write their own configuration from scratch for every tool server they wanted to wrap. This would be slow, error-prone, and would result in inconsistent quality. With the library, a user can adopt a vetted, sensible default in seconds and customize from there if needed.

The library also serves as documentation by example: the best way to learn how to use the product is to read its bundled configurations.

**What value it delivers**

- Instant adoption for the 20 most common AI-on-data integrations
- A trustworthy starting point that incorporates the maintainer's experience and the project's best practices
- Predictable, comparable behavior across teams adopting the same configuration

---

## 10. Documentation & Support Components

> The product is only as usable as its documentation. These components are the writing — not the code — that surrounds the project.

### Component 28 — User Manual (README)

**What it is**

The primary entry point for any new user. A comprehensive document covering:

- What the product is and what problem it solves
- Quickstart instructions
- Measured benchmark results (so users know the productivity claim is real)
- A complete reference for every configurable option
- Frequently asked questions
- Links to all other documentation

**Why it is needed**

The README is what a prospective user reads in the first three minutes after finding the project. It determines whether they continue or move on.

**What value it delivers**

Adoption. A great README turns curiosity into installation.

---

### Component 29 — Architecture Document

**What it is**

A deeper explanation of how the product is designed: the message flow, the component model, the security architecture, the trust model, the rationale for key design decisions.

**Why it is needed**

Serious adopters (especially security teams) need to understand *how* the product works before they trust it with sensitive data. Engineers contributing to the project need to understand the design before changing it.

**What value it delivers**

Trust from sophisticated evaluators. A faster on-ramp for contributors.

---

### Component 30 — Security Document

**What it is**

An explicit statement of the project's threat model, security guarantees, defence-in-depth philosophy, and responsible disclosure policy. It tells security teams exactly which threats the product addresses, which it does not, and what to do if they find a vulnerability.

**Why it is needed**

Without an explicit security document, the project cannot be evaluated by security teams — they will assume it is unsafe. With one, the project can be vetted against a stated threat model.

**What value it delivers**

Acceptance by security-conscious organizations. A clear, public process for vulnerability handling.

---

### Component 31 — Contribution Guide

**What it is**

A document explaining to outside contributors how to set up the project, what the code-style rules are, what kinds of contributions are welcome, how to submit a new pre-built configuration, and how the review process works.

**Why it is needed**

Open-source projects live or die by their contribution velocity. Without a guide, every contributor's first PR is friction-filled and the maintainers spend their time on basic style corrections rather than substantive review.

**What value it delivers**

More contributions, of higher quality, with less maintainer effort per contribution.

---

### Component 32 — Code of Conduct

**What it is**

A standard, industry-recognized document (the Contributor Covenant) defining acceptable and unacceptable behavior in the project's community.

**Why it is needed**

Open-source projects that lack a code of conduct often develop hostile or exclusionary cultures. A published, enforced code of conduct keeps the community healthy and welcoming.

**What value it delivers**

A diverse, productive contributor base. Reduced risk of incidents requiring crisis management.

---

### Component 33 — Support Document

**What it is**

A short document directing users to the right place for different kinds of questions: bug reports, feature requests, security disclosures, commercial enquiries, and general community discussion.

**Why it is needed**

Without it, every kind of question lands in the same place (usually the issue tracker), which becomes a noisy and unhelpful mess.

**What value it delivers**

Faster, higher-quality support for users. Maintainers' time is spent on the right things.

---

### Component 34 — Change Log

**What it is**

A version-by-version history of every meaningful change to the product, automatically generated from commit messages following an industry-standard convention.

**Why it is needed**

Users upgrading from one version to another need to know what changed: new features they can adopt, behaviors that might be different, security fixes they should hurry to apply.

**What value it delivers**

Confidence in upgrades. Reduced support load. A professional appearance.

---

### Component 35 — Contributor License Agreement

**What it is**

A legal document that outside contributors must sign before their code can be accepted. It grants the project the right to use, modify, and (importantly) re-license their contributions.

**Why it is needed**

The product has two licenses: a free open-source one (AGPL-3.0) and a paid commercial one. Without a CLA, the project could not legally offer contributed code under the commercial license. The CLA also reduces the risk of future licensing disputes.

**What value it delivers**

A sustainable dual-license business model. Legal clarity for the project's owners and contributors.

---

### Component 36 — Open-Source License

**What it is**

The standard AGPL-3.0 license, granting anyone the right to use, modify, and redistribute the product, with the requirement that improvements made available as a network service be made available as source code.

**Why it is needed**

The license sets the terms of use for the free version of the product. AGPL was chosen because it prevents large cloud providers from taking the product, embedding it in a paid service, and contributing nothing back.

**What value it delivers**

A genuinely free version of the product for individual users and small teams, while preserving the project owners' ability to sustain the project through a commercial offering.

---

### Component 37 — Commercial License

**What it is**

An alternative license available for purchase, granting use of the product under terms friendlier to companies that cannot accept AGPL's reciprocity requirements (typically, large enterprises whose legal teams refuse AGPL on principle).

**Why it is needed**

Many organizations have policies that forbid the use of AGPL-licensed software. Without a commercial alternative, the project would be unusable for those organizations — and would have no path to monetization.

**What value it delivers**

A revenue path that sustains ongoing development of the open-source product. A way for enterprise users to adopt the product without their legal teams blocking it.

---

## 11. Distribution & Release Components

### Component 38 — MCP Registry Metadata

**What it is**

A machine-readable description of the product, conformant to the schema used by the central Model Context Protocol registry. It tells the registry what the product is, where it lives, how to install it, what arguments it takes, and what environment variables it understands.

**Why it is needed**

The MCP ecosystem includes a central registry where AI clients discover available servers. To be findable by users browsing that registry, every project must publish this metadata.

**What value it delivers**

Discoverability. Users browsing the official MCP registry can find and install the product without leaving the registry interface.

---

### Component 39 — Quick-Start Configuration Snippet

**What it is**

A minimal configuration file demonstrating how to invoke the product from a typical AI client (such as Claude Desktop or Cursor). It is intended to be copied and pasted directly by new users.

**Why it is needed**

The biggest barrier to adoption is the first five minutes. A snippet that "just works" removes that barrier entirely.

**What value it delivers**

A measurable conversion improvement from "saw the project" to "successfully running it."

---

### Component 40 — Directory Listing Metadata

**What it is**

A small metadata file used by third-party directory sites (like Glama.ai) that catalog MCP servers. It identifies the project, its maintainers, and key attributes.

**Why it is needed**

Multiple independent directories aggregate MCP servers. Each has its own metadata format. Without listing in those directories, a portion of the user base never finds the project.

**What value it delivers**

Reach. The project shows up in every place users go looking for MCP servers.

---

## 12. Success Criteria

The project is considered successful if all of the following are true:

### 12.1 Functional Success

- An operator can install the product and protect a real tool server in under five minutes
- All 40 components listed above are present, working, and tested
- Every pre-built configuration in the library is verified at least once per quarter

### 12.2 Performance Success

- Latency added by the policy layer is imperceptible to humans in real AI sessions (sub-millisecond per message overhead)
- The Schema Pre-Loader delivers a measurable reduction in tokens and time in realistic database AI sessions

### 12.3 Quality Success

- The test suite covers every component
- Every code change passes the continuous integration pipeline before merging
- No high-severity vulnerabilities present in dependencies

### 12.4 Documentation Success

- A new user can read the README and have a working setup in under five minutes
- A security team can read the Security Document and complete a threat assessment without contacting the maintainers
- A contributor can read the Contribution Guide and submit a working pull request without further help

### 12.5 Adoption Success

- The project is listed in the official MCP registry and at least one third-party MCP directory
- The pre-built configuration library covers the most common AI-on-data integrations

---

## 13. Out-of-Scope

This section documents what the product is **not** trying to do — useful both for managing expectations and for resisting feature creep.

| Area | Why Out of Scope |
|---|---|
| **A hosted, multi-tenant gateway service** | Conflicts with the local-only, no-cloud value proposition. A hosted version may be considered in a future commercial offering, but is not part of the core product. |
| **A graphical user interface (GUI)** | The product's audience is technical. A GUI would multiply maintenance burden without serving the primary users. Configurations are intentionally simple text files. |
| **Built-in vulnerability scanning of AI prompts** | Belongs to a different category of tool (prompt-injection scanners, AI red-teaming platforms). The product focuses on what the AI *does*, not on the prompts users send to it. |
| **Reimplementation of MCP servers** | The product wraps existing servers; it does not replace them. Each tool server's maintainers are better positioned to maintain their own server. |
| **Real-time alerting and dashboards** | The Telemetry Recorder emits standard-format data; alerting is the job of the operator's existing observability stack (Grafana, Datadog, etc.). |
| **Identity and access management** | The product trusts the operator who launches it. Multi-user IAM is not in scope; it is the job of the operating system, the AI client, and the upstream tool server. |
| **Encryption at rest of audit logs** | The audit log is written to whatever sink the operator specifies. Encryption is the operator's responsibility, using their existing file system or log infrastructure. |

---

## 14. Risks & Assumptions

### 14.1 Key Assumptions

- The Model Context Protocol continues to be widely adopted (the product depends on the existence of MCP servers to wrap)
- AI assistants continue to consume tool descriptions in a way that makes Description-Injector and Schema-Pre-Loader effective (this is a stable property of every major AI model today)
- Operators have at least basic comfort with the command line and configuration files
- The Node.js runtime remains a viable choice for cross-platform desktop tooling

### 14.2 Key Risks

| Risk | Severity | Mitigation |
|---|---|---|
| MCP protocol changes incompatibly | High | Pin to current protocol version; track upstream changes closely; release updates promptly |
| A bug in a security component causes a real incident | High | Comprehensive test suite; security-focused review for changes to gate components; clear vulnerability disclosure process |
| Pre-built configurations rot as upstream servers evolve | Medium | Automated validation tool catches drift; status labels make staleness visible to users |
| Adoption stalls because of AGPL aversion | Medium | Commercial license alternative; clear messaging about which audience each license serves |
| A widely-used dependency has a critical vulnerability | Medium | Automated dependency scanning; small dependency footprint; lazy-loading minimizes attack surface |
| Performance overhead becomes noticeable on slower hardware | Low | Continuous benchmark; lazy-loading means inactive features cost nothing |

---

## 15. Glossary

| Term | Plain-English Meaning |
|---|---|
| **AI assistant** | A product like Claude, ChatGPT, Cursor, or Copilot that can chat with the user and (with MCP) take actions on their behalf. |
| **MCP** (Model Context Protocol) | A recently introduced open standard that lets AI assistants connect to external "tool servers." |
| **MCP server** | A program that exposes a set of capabilities (tools) to AI assistants. Examples: a server that lets the AI query a database, a server that lets the AI read files, a server that lets the AI search GitHub. |
| **Tool** | One specific capability of an MCP server. For example, "execute_sql" is a tool that lets the AI run a SQL query. |
| **Lens** | A pre-built configuration for the product that wraps one specific MCP server. The product ships with 20 lenses for popular MCP servers. |
| **Policy** | A rule the operator wants enforced — for example, "no destructive SQL," "no calls to the delete_user tool," "scrub email addresses from results." |
| **Gate component** | A policy module that can refuse a tool call. If it has an internal problem, it fails safely by refusing rather than letting the call through. |
| **Observer component** | A policy module that watches or modifies messages without refusing them. If it has an internal problem, it logs the issue and lets the message through unchanged. |
| **Defence in depth** | A security philosophy: layer multiple independent protections so that if one fails, others still work. The product applies this philosophy throughout. |
| **Audit log** | A structured record of every meaningful event in a session — who did what, when, with what result. |
| **PII** | Personally identifiable information — data that could identify a specific person (name, email, phone, government ID, etc.). |
| **Trust on first use** (TOFU) | A security technique where the first time something is used, its current state is recorded, and any later change requires explicit re-approval. |
| **Token** | A unit of text consumption by AI models. AI services charge by tokens; reducing tokens reduces cost and latency. |
| **OpenTelemetry** | An industry-standard format for emitting operational metrics (timings, counts, traces) that any modern observability tool can consume. |
| **YAML** | A human-readable text format commonly used for configuration files. JanuScope configurations are written in YAML. |
| **Stdio** | "Standard input/output" — the simplest way two programs on the same computer can communicate, by reading and writing text. MCP commonly uses stdio. |
| **AGPL** | A specific open-source license that requires improvements to the software to be shared, including when used as a network service. The product's primary license. |

---

*End of requirements document.*
