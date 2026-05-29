import { createHash } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import type { Overlay, OverlayContext } from "../pipeline.js";
import {
  isErrorResponse,
  isRequest,
  isSuccess,
  type JsonRpcId,
  type JsonRpcMessage,
} from "../rpc.js";

export interface AuditConfig {
  sink: string;
  identity?: Record<string, string>;
  logRawArgs?: boolean;
}

interface PendingCall {
  method: string;
  toolName?: string;
  startedAt: string;
}

interface AuditEvent {
  timestamp: string;
  direction: "client" | "server";
  method: string;
  id: JsonRpcId;
  toolName?: string;
  outcome: "request" | "success" | "error";
  identity?: Record<string, string>;
  argsHash?: string;
  args?: unknown;
  errorCode?: number;
  errorMessage?: string;
  durationMs?: number;
}

function hashArgs(args: unknown): string {
  const json = JSON.stringify(args ?? null);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

function extractToolName(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function extractToolArgs(params: unknown): unknown {
  if (typeof params !== "object" || params === null) return undefined;
  return (params as { arguments?: unknown }).arguments;
}

export function createAuditOverlay(config: AuditConfig): Overlay {
  const logRawArgs = config.logRawArgs ?? false;
  const identity = config.identity;
  let stream: WriteStream | null = null;
  const pending = new Map<JsonRpcId, PendingCall>();

  function write(event: AuditEvent, ctx: OverlayContext): void {
    if (!stream) return;
    try {
      stream.write(JSON.stringify(event) + "\n");
    } catch (err) {
      ctx.log(
        "warn",
        `audit write failed: ${(err as Error).message ?? String(err)}`,
      );
    }
  }

  return {
    name: "audit",
    kind: "observer",

    setup(ctx: OverlayContext) {
      stream = createWriteStream(config.sink, { flags: "a" });
      stream.on("error", (err) => {
        ctx.log("warn", `audit sink error: ${err.message}`);
      });
    },

    async teardown() {
      if (!stream) return;
      const s = stream;
      stream = null;
      await new Promise<void>((resolve) => s.end(() => resolve()));
    },

    onClientMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isRequest(msg)) return;
      if (msg.method !== "tools/call") return;

      const toolName = extractToolName(msg.params);
      const args = extractToolArgs(msg.params);
      const startedAt = new Date().toISOString();

      pending.set(msg.id, { method: msg.method, toolName, startedAt });

      const event: AuditEvent = {
        timestamp: startedAt,
        direction: "client",
        method: msg.method,
        id: msg.id,
        toolName,
        outcome: "request",
        argsHash: hashArgs(args),
      };
      if (identity) event.identity = identity;
      if (logRawArgs) event.args = args;
      write(event, ctx);
    },

    onServerMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isSuccess(msg) && !isErrorResponse(msg)) return;

      const id = msg.id;
      const matching = pending.get(id);
      if (!matching) return;

      pending.delete(id);

      const finishedAt = new Date().toISOString();
      const durationMs =
        new Date(finishedAt).getTime() -
        new Date(matching.startedAt).getTime();

      const event: AuditEvent = {
        timestamp: finishedAt,
        direction: "server",
        method: matching.method,
        id,
        toolName: matching.toolName,
        outcome: isSuccess(msg) ? "success" : "error",
        durationMs,
      };
      if (identity) event.identity = identity;
      if (isErrorResponse(msg)) {
        event.errorCode = msg.error.code;
        event.errorMessage = msg.error.message;
      }
      write(event, ctx);
    },
  };
}
