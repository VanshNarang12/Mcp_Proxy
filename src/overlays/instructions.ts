import type { Overlay, OverlayContext } from "../pipeline.js";
import { isSuccess, type JsonRpcMessage } from "../rpc.js";

export interface InstructionRule {
  tool: string;
  prepend?: string;
  append?: string;
  replace?: string;
}

export interface InstructionsConfig {
  rules: InstructionRule[];
}

interface CompiledRule {
  toolRegex: RegExp;
  prepend?: string;
  append?: string;
  replace?: string;
}

interface ToolDef {
  name: string;
  description?: string;
  [key: string]: unknown;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcards}$`);
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

function applyRule(currentDescription: string, rule: CompiledRule): string {
  if (rule.replace !== undefined) return rule.replace;
  let next = currentDescription;
  if (rule.prepend) next = rule.prepend + next;
  if (rule.append) next = next + rule.append;
  return next;
}

export function createInstructionsOverlay(
  config: InstructionsConfig,
): Overlay {
  const rules: CompiledRule[] = config.rules.map((r) => ({
    toolRegex: patternToRegex(r.tool),
    prepend: r.prepend,
    append: r.append,
    replace: r.replace,
  }));

  return {
    name: "instructions",
    kind: "observer",

    onServerMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isSuccess(msg)) return;
      if (!isToolsListResult(msg.result)) return;
      if (rules.length === 0) return;

      let changed = 0;
      const newTools = msg.result.tools.map((tool) => {
        const matching = rules.find((r) => r.toolRegex.test(tool.name));
        if (!matching) return tool;

        const current = tool.description ?? "";
        const next = applyRule(current, matching);
        if (next === current) return tool;

        changed++;
        return { ...tool, description: next };
      });

      if (changed === 0) return;

      ctx.log("info", `rewrote ${changed} tool description(s)`);
      return {
        forward: {
          ...msg,
          result: { ...msg.result, tools: newTools },
        },
      };
    },
  };
}
