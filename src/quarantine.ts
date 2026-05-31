import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { OverlayConfig } from "./config.js";

/**
 * Quarantine & Trust (FR-QUAR). Trust-on-first-use for both the static policy
 * config and the live tool surface of the target. We fingerprint what was
 * approved and refuse to run (or fail tools/list) when it changes underneath us.
 *
 * This module is pure logic + an injectable file store: every entry point takes
 * an explicit `storePath` so tests never touch the real ~/.mcp-middleware file.
 */

export interface ApprovalEntry {
  configPath: string;
  version: string;
  approvedAt: string;
  staticFingerprint: string;
  /** Per-component sub-hashes, so we can report WHICH component drifted. */
  subHashes: Record<string, string>;
  /** Overall live-tools hash; present once the tool surface is observed. */
  liveToolsFingerprint?: string;
  /** Per-tool hashes (name -> hash), used to diff added/removed/modified. */
  liveTools?: Record<string, string>;
  liveToolsApprovedAt?: string;
}

export type ApprovalStore = Record<string, ApprovalEntry>;

/** A tool definition as it appears in a tools/list response. */
export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  [key: string]: unknown;
}

// ----- canonicalization & hashing -------------------------------------------

/** Recursively sort object keys so JSON is stable regardless of key order. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** Stable string form of any JSON value (FR-QUAR-004). */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ----- static fingerprint (FR-QUAR-002/003) ---------------------------------

// Only security-relevant components are fingerprinted (note: audit and
// instructions are intentionally excluded — changing them is not a trust event).
function staticComponents(config: OverlayConfig): Record<string, unknown> {
  return {
    target: { command: config.target.command, args: config.target.args },
    block: config.block ?? null,
    sqlGuard: config.sqlGuard ?? null,
    rateLimit: config.rateLimit ?? null,
    redact: config.redact ?? null,
    classification: config.classification ?? null,
  };
}

export interface StaticFingerprint {
  fingerprint: string;
  subHashes: Record<string, string>;
}

export function computeStaticFingerprint(
  config: OverlayConfig,
): StaticFingerprint {
  const components = staticComponents(config);
  const subHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(components)) {
    subHashes[name] = sha256(canonicalize(value));
  }
  // The overall fingerprint hashes the sub-hash map, so it changes iff any
  // component changes.
  const fingerprint = sha256(canonicalize(subHashes));
  return { fingerprint, subHashes };
}

// ----- live tool fingerprint (FR-QUAR-005/006) -------------------------------

/** Hash of one tool over exactly {name, description, inputSchema, annotations}. */
export function hashTool(tool: ToolDef): string {
  return sha256(
    canonicalize({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }),
  );
}

/** Map of tool name -> per-tool hash. */
export function toolHashMap(tools: ToolDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tool of tools) map[tool.name] = hashTool(tool);
  return map;
}

/** Order-independent fingerprint of the whole tool surface (FR-QUAR-006). */
export function computeLiveToolsFingerprint(tools: ToolDef[]): string {
  const map = toolHashMap(tools);
  const sorted = Object.keys(map)
    .sort()
    .map((name) => [name, map[name]]);
  return sha256(canonicalize(sorted));
}

export interface ToolDrift {
  added: string[];
  removed: string[];
  modified: string[];
}

/** Diff a previously approved per-tool hash map against the current tools. */
export function diffToolMaps(
  approved: Record<string, string>,
  current: Record<string, string>,
): ToolDrift {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const name of Object.keys(current)) {
    if (!(name in approved)) added.push(name);
    else if (approved[name] !== current[name]) modified.push(name);
  }
  for (const name of Object.keys(approved)) {
    if (!(name in current)) removed.push(name);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    modified: modified.sort(),
  };
}

export function hasDrift(drift: ToolDrift): boolean {
  return (
    drift.added.length > 0 ||
    drift.removed.length > 0 ||
    drift.modified.length > 0
  );
}

// ----- approval store (FR-QUAR-010..013) -------------------------------------

export function defaultStorePath(): string {
  return join(homedir(), ".mcp-middleware", "approved.json");
}

export function loadStore(storePath: string): ApprovalStore {
  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ApprovalStore;
    return {};
  } catch {
    // Missing or unreadable store -> empty (first run).
    return {};
  }
}

/** Atomic write (temp file + rename) with 0600 perms (FR-QUAR-013, FR-QUAR-021). */
export function saveStore(storePath: string, store: ApprovalStore): void {
  const dir = dirname(storePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${storePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, storePath);
}

// ----- check & record APIs (FR-QUAR-020..023) --------------------------------

export interface QuarantineCheck {
  hasEntry: boolean;
  approved: boolean;
  /** Component names whose sub-hash differs from the approved entry. */
  drift: string[];
}

/** Compare the current static config against the stored approval (FR-QUAR-020). */
export function checkQuarantine(
  config: OverlayConfig,
  configPath: string,
  storePath: string,
): QuarantineCheck {
  const store = loadStore(storePath);
  const entry = store[configPath];
  if (!entry) return { hasEntry: false, approved: false, drift: [] };

  const { subHashes } = computeStaticFingerprint(config);
  const drift: string[] = [];
  const names = new Set([
    ...Object.keys(subHashes),
    ...Object.keys(entry.subHashes),
  ]);
  for (const name of names) {
    if (subHashes[name] !== entry.subHashes[name]) drift.push(name);
  }
  drift.sort();
  return { hasEntry: true, approved: drift.length === 0, drift };
}

/** Write (or replace) the static approval entry atomically (FR-QUAR-021). */
export function recordApproval(
  config: OverlayConfig,
  configPath: string,
  storePath: string,
  version: string,
  nowIso: string,
): ApprovalEntry {
  const store = loadStore(storePath);
  const { fingerprint, subHashes } = computeStaticFingerprint(config);
  // Re-baselining the static policy resets the live-tools approval so the new
  // surface is re-confirmed (on first use, or via a probe) rather than silently
  // inheriting the old baseline.
  const entry: ApprovalEntry = {
    configPath,
    version,
    approvedAt: nowIso,
    staticFingerprint: fingerprint,
    subHashes,
  };
  store[configPath] = entry;
  saveStore(storePath, store);
  return entry;
}

export interface LiveToolsCheck {
  approved: boolean;
  drift?: ToolDrift;
}

/** Compare current tools against the entry's approved baseline (FR-QUAR-022). */
export function checkLiveTools(
  entry: ApprovalEntry,
  tools: ToolDef[],
): LiveToolsCheck {
  if (!entry.liveTools) return { approved: true };
  const drift = diffToolMaps(entry.liveTools, toolHashMap(tools));
  if (!hasDrift(drift)) return { approved: true };
  return { approved: false, drift };
}

/** Atomically update an entry's live-tools baseline (FR-QUAR-023). */
export function recordLiveToolsApproval(
  configPath: string,
  tools: ToolDef[],
  storePath: string,
  nowIso: string,
): void {
  const store = loadStore(storePath);
  const entry = store[configPath];
  if (!entry) return;
  entry.liveTools = toolHashMap(tools);
  entry.liveToolsFingerprint = computeLiveToolsFingerprint(tools);
  entry.liveToolsApprovedAt = nowIso;
  saveStore(storePath, store);
}
