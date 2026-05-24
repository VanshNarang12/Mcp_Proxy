#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Pipeline, type Overlay } from "./pipeline.js";
import { runStdioTransport } from "./transport/stdio.js";
import { createBlockOverlay } from "./overlays/block.js";
import { loadConfig, type OverlayConfig } from "./config.js";

const USAGE = `Usage:
  mcp-middleware --config <path>
  mcp-middleware --target "<command> [args...]" [--block "name1,name2,..."]

Examples:
  mcp-middleware --config ./mylens.yaml
  mcp-middleware --target "python server.py" --block "delete_*,admin_users"

--config loads a YAML or JSON file (full feature set).
--target / --block are for quick tests without a config file.
The two modes are mutually exclusive.`;

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

async function main(): Promise<void> {
  let config: string | undefined;
  let target: string | undefined;
  let block: string | undefined;
  try {
    const { values } = parseArgs({
      options: {
        config: { type: "string" },
        target: { type: "string" },
        block: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    config = values.config;
    target = values.target;
    block = values.block;
  } catch (err) {
    die(`mcp-middleware: ${(err as Error).message}`);
  }

  if (config && (target || block)) {
    die("mcp-middleware: --config cannot be combined with --target or --block");
  }

  const resolved = config
    ? fromConfigFile(config)
    : fromCliFlags(target, block);

  const overlays: Overlay[] = [];
  if (resolved.blockTools.length > 0) {
    overlays.push(createBlockOverlay({ tools: resolved.blockTools }));
    process.stderr.write(
      `[mcp-middleware] block overlay active: ${resolved.blockTools.join(", ")}\n`,
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
