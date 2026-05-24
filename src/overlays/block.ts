import type { Overlay, OverlayContext } from "../pipeline.js";
import {
  isRequest,
  isSuccess,
  makeErrorResponse,
  type JsonRpcMessage,
} from "../rpc.js";

export interface BlockOverlayConfig {
  tools: string[];
}

interface ToolDef {
  name: string;
  [key: string]: unknown;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcards}$`);
}

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

function extractToolName(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function isToolsListResult(result: unknown): result is { tools: ToolDef[] } {
  if (typeof result !== "object" || result === null) return false;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return false;
  return tools.every(
    (t) =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as ToolDef).name === "string",
  );
}

export function createBlockOverlay(config: BlockOverlayConfig): Overlay {
  const patterns = config.tools.map(patternToRegex);

  return {
    name: "block",
    kind: "gate",

    onClientMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isRequest(msg)) return;
      if (msg.method !== "tools/call") return;
      const name = extractToolName(msg.params);
      if (name === null) return;
      if (!matchesAny(name, patterns)) return;

      ctx.log("info", `blocked tools/call for "${name}"`);
      return {
        respond: makeErrorResponse(msg.id, -32601, `Tool not found: ${name}`),
      };
    },

    onServerMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isSuccess(msg)) return;
      if (!isToolsListResult(msg.result)) return;

      const before = msg.result.tools.length;
      const after = msg.result.tools.filter(
        (t) => !matchesAny(t.name, patterns),
      );
      if (after.length === before) return;

      ctx.log(
        "info",
        `filtered ${before - after.length} tool(s) from tools/list`,
      );
      return {
        forward: {
          ...msg,
          result: {
            ...msg.result,
            tools: after,
          },
        },
      };
    },
  };
}
