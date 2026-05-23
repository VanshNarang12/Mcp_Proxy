import type { JsonRpcMessage } from "./rpc.js";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface OverlayContext {
  log: (level: LogLevel, message: string, data?: unknown) => void;
  state: Record<string, unknown>;
}

export interface MessageResult {
  forward?: JsonRpcMessage;
  respond?: JsonRpcMessage;
}

export interface Overlay {
  name: string;
  kind?: "gate" | "observer";
  setup?(ctx: OverlayContext): Promise<void> | void;
  teardown?(ctx: OverlayContext): Promise<void> | void;
  onClientMessage?(
    msg: JsonRpcMessage,
    ctx: OverlayContext,
  ): Promise<MessageResult | void> | MessageResult | void;
  onServerMessage?(
    msg: JsonRpcMessage,
    ctx: OverlayContext,
  ): Promise<MessageResult | void> | MessageResult | void;
}

const LOG_PREFIX = "[mcp-middleware";

function buildLogger(overlayName: string): OverlayContext["log"] {
  return (level, message, data) => {
    const head = `${LOG_PREFIX}:${overlayName}] ${level} ${message}`;
    if (data !== undefined) {
      process.stderr.write(`${head} ${safeJson(data)}\n`);
    } else {
      process.stderr.write(`${head}\n`);
    }
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export class Pipeline {
  private readonly contexts = new Map<string, OverlayContext>();

  constructor(private readonly overlays: Overlay[] = []) {
    for (const overlay of overlays) {
      this.contexts.set(overlay.name, {
        log: buildLogger(overlay.name),
        state: {},
      });
    }
  }

  async setup(): Promise<void> {
    for (const overlay of this.overlays) {
      if (!overlay.setup) continue;
      const ctx = this.contexts.get(overlay.name);
      if (!ctx) continue;
      await overlay.setup(ctx);
    }
  }

  async teardown(): Promise<void> {
    for (const overlay of this.overlays) {
      if (!overlay.teardown) continue;
      const ctx = this.contexts.get(overlay.name);
      if (!ctx) continue;
      try {
        await overlay.teardown(ctx);
      } catch (err) {
        process.stderr.write(
          `${LOG_PREFIX}:pipeline] warn teardown failed for ${overlay.name}: ${
            (err as Error).message
          }\n`,
        );
      }
    }
  }

  async handleClientMessage(msg: JsonRpcMessage): Promise<MessageResult> {
    return this.runChain(msg, "onClientMessage");
  }

  async handleServerMessage(msg: JsonRpcMessage): Promise<MessageResult> {
    return this.runChain(msg, "onServerMessage");
  }

  private async runChain(
    msg: JsonRpcMessage,
    direction: "onClientMessage" | "onServerMessage",
  ): Promise<MessageResult> {
    let current: JsonRpcMessage = msg;

    for (const overlay of this.overlays) {
      const handler = overlay[direction];
      if (!handler) continue;
      const ctx = this.contexts.get(overlay.name);
      if (!ctx) continue;

      try {
        const result = await handler.call(overlay, current, ctx);
        if (!result) continue;
        if (result.respond) {
          return { respond: result.respond };
        }
        if (result.forward) {
          current = result.forward;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        ctx.log("error", `overlay threw: ${errMsg}`);
        if (overlay.kind === "gate") {
          return { respond: makeInternalError(current, errMsg) };
        }
      }
    }

    return { forward: current };
  }
}

function makeInternalError(
  original: JsonRpcMessage,
  reason: string,
): JsonRpcMessage {
  const id =
    "id" in original && original.id !== undefined ? original.id : null;
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32603,
      message: `Internal error: ${reason}`,
    },
  };
}
