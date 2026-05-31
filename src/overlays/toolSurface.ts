import type { Overlay, OverlayContext } from "../pipeline.js";
import {
  isSuccess,
  makeErrorResponse,
  RpcErrorCode,
  type JsonRpcMessage,
} from "../rpc.js";
import {
  diffToolMaps,
  hasDrift,
  toolHashMap,
  type ToolDef,
  type ToolDrift,
} from "../quarantine.js";

/**
 * Tool Surface Drift gate (FR-DRIFT). Watches tools/list responses and compares
 * the live tool surface against the approved baseline. A change to ANY tool's
 * name, description, inputSchema, or annotations is drift — so this also catches
 * the "the menu looks the same but a tool's description was poisoned" attack,
 * not just newly added tools.
 *
 * The store is injected via `deps` so the overlay stays free of filesystem
 * concerns (and is trivially testable).
 */
export interface ToolSurfaceDeps {
  configPath: string;
  /** Approved per-tool hash map, or null if no live baseline exists yet. */
  getBaseline(): Record<string, string> | null;
  /** Persist the current per-tool hash map as the approved baseline (TOFU). */
  saveBaseline(tools: ToolDef[]): void;
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

function describeDrift(drift: ToolDrift): string {
  const parts: string[] = [];
  if (drift.added.length) parts.push(`added [${drift.added.join(", ")}]`);
  if (drift.removed.length) parts.push(`removed [${drift.removed.join(", ")}]`);
  if (drift.modified.length)
    parts.push(`modified [${drift.modified.join(", ")}]`);
  return parts.join("; ");
}

export function createToolSurfaceOverlay(deps: ToolSurfaceDeps): Overlay {
  // Sticky failure (FR-DRIFT-006): once drift is seen, every later tools/list
  // is failed with the same error until the operator re-approves.
  let driftError: string | null = null;

  function buildError(drift: ToolDrift): string {
    return (
      `tool surface drift detected for ${deps.configPath}: ${describeDrift(drift)}. ` +
      `Run \`mcp-middleware approve --config ${deps.configPath}\` to re-baseline.`
    );
  }

  return {
    name: "toolSurface",
    kind: "gate",

    onServerMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isSuccess(msg)) return;
      if (!isToolsListResult(msg.result)) return;

      // Already drifted this session — keep failing (FR-DRIFT-006).
      if (driftError !== null) {
        return {
          forward: makeErrorResponse(
            msg.id,
            RpcErrorCode.ServerError,
            driftError,
          ),
        };
      }

      const tools = msg.result.tools;
      const baseline = deps.getBaseline();

      // Trust on first use (FR-DRIFT-004): no baseline yet -> record & pass.
      if (baseline === null) {
        deps.saveBaseline(tools);
        ctx.log("info", "tools approved on first use");
        return;
      }

      const drift = diffToolMaps(baseline, toolHashMap(tools));
      if (!hasDrift(drift)) return;

      // Drift! Latch the error and rewrite this response (FR-DRIFT-005).
      driftError = buildError(drift);
      ctx.log("warn", driftError);
      return {
        forward: makeErrorResponse(
          msg.id,
          RpcErrorCode.ServerError,
          driftError,
        ),
      };
    },
  };
}
