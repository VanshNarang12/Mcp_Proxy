import { spawn, type ChildProcess } from "node:child_process";
import { FrameDecoder, encodeFrame, type JsonRpcMessage } from "../rpc.js";
import type { Pipeline } from "../pipeline.js";

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  pipeline: Pipeline;
}

const PREFIX = "[mcp-middleware:transport]";

export async function runStdioTransport(
  opts: StdioTransportOptions,
): Promise<number> {
  const child: ChildProcess = spawn(opts.command, opts.args ?? [], {
    env: { ...process.env, ...(opts.env ?? {}) },
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });

  child.on("error", (err) => {
    process.stderr.write(`${PREFIX} spawn error: ${err.message}\n`);
  });

  const clientDecoder = new FrameDecoder();
  const targetDecoder = new FrameDecoder();

  clientDecoder.on("message", (msg: JsonRpcMessage) => {
    void handleClient(msg, opts.pipeline, child);
  });
  clientDecoder.on("malformed", (_line, err) => {
    process.stderr.write(
      `${PREFIX} malformed client frame: ${(err as Error).message}\n`,
    );
  });

  targetDecoder.on("message", (msg: JsonRpcMessage) => {
    void handleTarget(msg, opts.pipeline);
  });
  targetDecoder.on("malformed", (_line, err) => {
    process.stderr.write(
      `${PREFIX} malformed target frame: ${(err as Error).message}\n`,
    );
  });

  process.stdin.on("data", (chunk: Buffer) => clientDecoder.push(chunk));
  process.stdin.on("end", () => {
    clientDecoder.end();
    child.stdin?.end();
  });

  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => targetDecoder.push(chunk));
    child.stdout.on("end", () => targetDecoder.end());
  }

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        process.stderr.write(`${PREFIX} target exited via ${signal}\n`);
      }
      resolve(code ?? 0);
    });

    const propagate = (signal: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(signal);
    };
    process.on("SIGINT", propagate("SIGINT"));
    process.on("SIGTERM", propagate("SIGTERM"));
  });

  return exitCode;
}

async function handleClient(
  msg: JsonRpcMessage,
  pipeline: Pipeline,
  child: ChildProcess,
): Promise<void> {
  try {
    const result = await pipeline.handleClientMessage(msg);
    if (result.respond) {
      process.stdout.write(encodeFrame(result.respond));
      return;
    }
    if (result.forward && child.stdin && !child.stdin.destroyed) {
      const ok = child.stdin.write(encodeFrame(result.forward));
      if (!ok) {
        await new Promise<void>((resolve) =>
          child.stdin!.once("drain", () => resolve()),
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `${PREFIX} client pipeline error: ${(err as Error).message}\n`,
    );
  }
}

async function handleTarget(
  msg: JsonRpcMessage,
  pipeline: Pipeline,
): Promise<void> {
  try {
    const result = await pipeline.handleServerMessage(msg);
    const out = result.respond ?? result.forward;
    if (out) {
      const ok = process.stdout.write(encodeFrame(out));
      if (!ok) {
        await new Promise<void>((resolve) =>
          process.stdout.once("drain", () => resolve()),
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `${PREFIX} target pipeline error: ${(err as Error).message}\n`,
    );
  }
}
