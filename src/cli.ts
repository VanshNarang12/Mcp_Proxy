#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { Pipeline, type Overlay } from "./pipeline.js";
import { runStdioTransport } from "./transport/stdio.js";
import { createBlockOverlay } from "./overlays/block.js";
import { createAuditOverlay, type AuditConfig } from "./overlays/audit.js";
import { createRedactOverlay, type RedactConfig } from "./overlays/redact.js";
import {
  createInstructionsOverlay,
  type InstructionsConfig,
} from "./overlays/instructions.js";
import {
  createSqlGuardOverlay,
  type SqlGuardConfig,
} from "./overlays/sqlGuard.js";
import {
  createRateLimitOverlay,
  type RateLimitConfig,
} from "./overlays/rateLimit.js";
import {
  createToolSurfaceOverlay,
  type ToolSurfaceDeps,
} from "./overlays/toolSurface.js";
import { loadConfig, type OverlayConfig } from "./config.js";
import {
  checkQuarantine,
  defaultStorePath,
  loadStore,
  recordApproval,
  recordLiveToolsApproval,
  type ToolDef,
} from "./quarantine.js";

function getVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const USAGE = `Usage:
  mcp-middleware --config <path>
  mcp-middleware --target "<command> [args...]" [--block "name1,name2,..."]
  mcp-middleware approve --config <path>
  mcp-middleware --version | --help

Examples:
  mcp-middleware --config ./mylens.yaml
  mcp-middleware --target "python server.py" --block "delete_*,admin_users"
  mcp-middleware approve --config ./mylens.yaml

--config loads a YAML or JSON file (full feature set).
--target / --block are for quick tests without a config file.
approve re-baselines the quarantine fingerprint for a config (use after an
intentional policy or tool-surface change).
The --config and --target modes are mutually exclusive.`;

function die(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

interface Resolved {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  blockTools: string[];
  audit?: AuditConfig;
  sqlGuard?: SqlGuardConfig;
  rateLimit?: RateLimitConfig;
  instructions?: InstructionsConfig;
  redact?: RedactConfig;
  // Present only in --config mode; needed to drive quarantine.
  config?: OverlayConfig;
  configPath?: string;
}

function fromConfigFile(path: string): Resolved {
  let cfg: OverlayConfig;
  try {
    cfg = loadConfig(path);
  } catch (err) {
    process.stderr.write(
      `mcp-middleware: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
  return {
    command: cfg.target.command,
    args: cfg.target.args,
    env: cfg.target.env,
    cwd: cfg.target.cwd,
    blockTools: cfg.block?.tools ?? [],
    audit: cfg.audit,
    sqlGuard: cfg.sqlGuard,
    rateLimit: cfg.rateLimit,
    instructions: cfg.instructions,
    redact: cfg.redact,
    config: cfg,
    configPath: path,
  };
}

function fromCliFlags(
  target: string | undefined,
  block: string | undefined,
): Resolved {
  const trimmed = target?.trim();
  if (!trimmed) {
    die("mcp-middleware: missing required --target (or use --config)");
  }
  // TODO: shell-aware splitting (quoted paths with spaces, env vars).
  const [command = "", ...args] = trimmed.split(/\s+/);
  if (!command) {
    die("mcp-middleware: --target is empty");
  }
  const blockTools = (block ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { command, args, blockTools };
}

// FR-QUAR-030/031: gate startup on the static fingerprint. Records on first
// use; refuses to start (exit 1) when the approved policy has drifted.
function runStaticQuarantine(
  cfg: OverlayConfig,
  configPath: string,
  version: string,
): void {
  const storePath = defaultStorePath();
  const check = checkQuarantine(cfg, configPath, storePath);
  if (!check.hasEntry) {
    recordApproval(
      cfg,
      configPath,
      storePath,
      version,
      new Date().toISOString(),
    );
    process.stderr.write(
      `[mcp-middleware] first-use approval recorded for ${configPath}\n`,
    );
    return;
  }
  if (!check.approved) {
    process.stderr.write(
      `[mcp-middleware] refusing to start: static policy drift in ` +
        `[${check.drift.join(", ")}] for ${configPath}.\n` +
        `Run \`mcp-middleware approve --config ${configPath}\` to re-baseline.\n`,
    );
    process.exit(1);
  }
}

// Backs the toolSurface overlay with the on-disk approval store. The static
// quarantine pass above guarantees an entry exists before this is used.
function makeToolSurfaceDeps(configPath: string): ToolSurfaceDeps {
  const storePath = defaultStorePath();
  return {
    configPath,
    getBaseline() {
      const entry = loadStore(storePath)[configPath];
      return entry?.liveTools ?? null;
    },
    saveBaseline(tools: ToolDef[]) {
      recordLiveToolsApproval(
        configPath,
        tools,
        storePath,
        new Date().toISOString(),
      );
    },
  };
}

// FR-CLI-013/015: re-baseline a config's static fingerprint. (Live-tools are
// reset by recordApproval and re-approved on next launch via trust-on-first-use;
// proactive probing is FR-CLI-014, not yet implemented.)
function runApprove(configPath: string | undefined, version: string): never {
  if (!configPath) {
    die("mcp-middleware: approve requires --config <path>");
  }
  let cfg: OverlayConfig;
  try {
    cfg = loadConfig(configPath);
  } catch (err) {
    process.stderr.write(
      `mcp-middleware: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
  recordApproval(
    cfg,
    configPath,
    defaultStorePath(),
    version,
    new Date().toISOString(),
  );
  process.stderr.write(`[mcp-middleware] approved: ${configPath}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  const version = getVersion();
  let config: string | undefined;
  let target: string | undefined;
  let block: string | undefined;
  let positionals: string[] = [];
  let showVersion = false;
  let showHelp = false;
  try {
    const parsed = parseArgs({
      options: {
        config: { type: "string" },
        target: { type: "string" },
        block: { type: "string" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: true,
    });
    config = parsed.values.config;
    target = parsed.values.target;
    block = parsed.values.block;
    showVersion = parsed.values.version ?? false;
    showHelp = parsed.values.help ?? false;
    positionals = parsed.positionals;
  } catch (err) {
    die(`mcp-middleware: ${(err as Error).message}`);
  }

  // FR-CLI-002/003/004.
  if (showVersion) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }
  if (showHelp) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (positionals.length === 0 && !config && !target) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }

  // Subcommands (FR-CLI-013): `approve --config <path>`.
  const subcommand = positionals[0];
  if (subcommand === "approve") {
    runApprove(config, version);
  }
  if (subcommand !== undefined) {
    die(`mcp-middleware: unknown subcommand "${subcommand}"`);
  }

  if (config && (target || block)) {
    die("mcp-middleware: --config cannot be combined with --target or --block");
  }

  const resolved = config
    ? fromConfigFile(config)
    : fromCliFlags(target, block);

  // FR-QUAR-001: quarantine is active only when the config opts in via
  // `firstRun: approve`. Run the static gate before spawning the target.
  const quarantineActive =
    resolved.config?.firstRun === "approve" && resolved.configPath;
  if (quarantineActive) {
    runStaticQuarantine(resolved.config!, resolved.configPath!, version);
  }

  const overlays: Overlay[] = [];
  // audit goes first so it sees the rawest message before any gate modifies it.
  if (resolved.audit) {
    overlays.push(createAuditOverlay(resolved.audit));
    process.stderr.write(
      `[mcp-middleware] audit overlay active: ${resolved.audit.sink}\n`,
    );
  }
  if (resolved.blockTools.length > 0) {
    overlays.push(createBlockOverlay({ tools: resolved.blockTools }));
    process.stderr.write(
      `[mcp-middleware] block overlay active: ${resolved.blockTools.join(", ")}\n`,
    );
  }
  // sqlGuard is a gate; it runs after block but before the observers so a
  // rejected write never reaches the target.
  if (resolved.sqlGuard && resolved.sqlGuard.tools.length > 0) {
    overlays.push(createSqlGuardOverlay(resolved.sqlGuard));
    process.stderr.write(
      `[mcp-middleware] sqlGuard overlay active: ${resolved.sqlGuard.mode ?? "allowlist"} on ${resolved.sqlGuard.tools.join(", ")}\n`,
    );
  }
  // rateLimit is a gate; it runs after sqlGuard (FR-PIPE-016) so a throttled
  // call is rejected before reaching the target.
  if (resolved.rateLimit && resolved.rateLimit.length > 0) {
    overlays.push(createRateLimitOverlay(resolved.rateLimit));
    process.stderr.write(
      `[mcp-middleware] rateLimit overlay active: ${resolved.rateLimit.length} rule(s)\n`,
    );
  }
  // toolSurface is the last gate (FR-PIPE-016). It watches tools/list for drift
  // from the approved baseline and is active only under firstRun: approve.
  if (quarantineActive) {
    overlays.push(
      createToolSurfaceOverlay(makeToolSurfaceDeps(resolved.configPath!)),
    );
    process.stderr.write(
      `[mcp-middleware] toolSurface overlay active: drift detection on ${resolved.configPath}\n`,
    );
  }
  // instructions runs after block so it only rewrites descriptions of tools
  // that survived the gate, but before redact (which only touches tools/call).
  if (resolved.instructions && resolved.instructions.rules.length > 0) {
    overlays.push(createInstructionsOverlay(resolved.instructions));
    process.stderr.write(
      `[mcp-middleware] instructions overlay active: ${resolved.instructions.rules.length} rule(s)\n`,
    );
  }
  // redact goes last so it acts on the response after audit has seen it raw.
  if (resolved.redact && resolved.redact.rules.length > 0) {
    overlays.push(createRedactOverlay(resolved.redact));
    process.stderr.write(
      `[mcp-middleware] redact overlay active: ${resolved.redact.rules.length} rule(s)\n`,
    );
  }

  const pipeline = new Pipeline(overlays);
  await pipeline.setup();

  let code = 0;
  try {
    code = await runStdioTransport({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      cwd: resolved.cwd,
      pipeline,
    });
  } finally {
    await pipeline.teardown();
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(
    `mcp-middleware: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
