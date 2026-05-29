import type { Overlay, OverlayContext } from "../pipeline.js";
import {
  isRequest,
  isSuccess,
  type JsonRpcId,
  type JsonRpcMessage,
} from "../rpc.js";

export interface RedactRule {
  name: string;
  pattern: string;
  replacement?: string;
}

export interface RedactConfig {
  rules: RedactRule[];
  defaultReplacement?: string;
}

interface CompiledRule {
  name: string;
  regex: RegExp;
  replacement: string;
}

function compileRules(config: RedactConfig): CompiledRule[] {
  const defaultReplacement = config.defaultReplacement ?? "[REDACTED]";
  return config.rules.map((rule) => ({
    name: rule.name,
    regex: new RegExp(rule.pattern, "g"),
    replacement: rule.replacement ?? defaultReplacement,
  }));
}

function redactValue(
  value: unknown,
  rules: CompiledRule[],
  hits: Record<string, number>,
): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const rule of rules) {
      let count = 0;
      result = result.replace(rule.regex, () => {
        count++;
        return rule.replacement;
      });
      if (count > 0) {
        hits[rule.name] = (hits[rule.name] ?? 0) + count;
      }
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, rules, hits));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, rules, hits);
    }
    return out;
  }
  return value;
}

export function createRedactOverlay(config: RedactConfig): Overlay {
  const rules = compileRules(config);
  // Only redact tool-call results. Track which request ids belong to tools/call
  // so we can recognise their matching response. Other traffic (initialize,
  // tools/list, ping, etc.) carries protocol fields we must NEVER mutate.
  const toolsCallIds = new Set<JsonRpcId>();

  return {
    name: "redact",
    // Fail-closed: if redaction crashes, the pipeline short-circuits with an
    // internal error rather than leaking the un-redacted response.
    kind: "gate",

    onClientMessage(msg: JsonRpcMessage) {
      if (!isRequest(msg)) return;
      if (msg.method !== "tools/call") return;
      toolsCallIds.add(msg.id);
    },

    onServerMessage(msg: JsonRpcMessage, ctx: OverlayContext) {
      if (!isSuccess(msg)) return;
      if (rules.length === 0) return;
      if (!toolsCallIds.has(msg.id)) return;
      toolsCallIds.delete(msg.id);

      const hits: Record<string, number> = {};
      const newResult = redactValue(msg.result, rules, hits);

      const total = Object.values(hits).reduce((a, b) => a + b, 0);
      if (total === 0) return;

      ctx.log("info", `redacted ${total} value(s)`, hits);

      return {
        forward: { ...msg, result: newResult } as JsonRpcMessage,
      };
    },
  };
}
