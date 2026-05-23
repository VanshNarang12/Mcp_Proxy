#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Pipeline } from "./pipeline.js";
import { runStdioTransport } from "./transport/stdio.js";

const USAGE = `Usage: mcp-middleware --target "<command> [args...]"

Example:
  mcp-middleware --target "python /path/to/server.py"

In Phase 1 the proxy forwards every frame unchanged. No overlays are loaded.`;

function die(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  let target: string | undefined;
  try {
    const { values } = parseArgs({
      options: { target: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
    target = values.target;
  } catch (err) {
    die(`mcp-middleware: ${(err as Error).message}`);
  }

  const trimmed = target?.trim();
  if (!trimmed) {
    die("mcp-middleware: missing required --target");
  }

  // TODO: shell-aware splitting (quoted paths with spaces, env vars).
  const [command = "", ...args] = trimmed.split(/\s+/);
  if (!command) {
    die("mcp-middleware: --target is empty");
  }

  const pipeline = new Pipeline([]);
  await pipeline.setup();

  let code = 0;
  try {
    code = await runStdioTransport({ command, args, pipeline });
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
