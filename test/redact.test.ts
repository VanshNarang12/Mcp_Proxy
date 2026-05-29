import { describe, it, expect } from "vitest";
import { createRedactOverlay } from "../src/overlays/redact.js";
import type { OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

function makeCtx(): OverlayContext {
  return { log: () => {}, state: {} };
}

function toolsCall(id: number, name = "x", args: unknown = {}): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

function toolsListRequest(id: number): JsonRpcMessage {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

function successReply(id: number, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result };
}

function errorReply(
  id: number,
  code: number,
  message: string,
): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

describe("createRedactOverlay", () => {
  describe("metadata", () => {
    it("has name 'redact' and kind 'gate'", () => {
      const overlay = createRedactOverlay({ rules: [] });
      expect(overlay.name).toBe("redact");
      expect(overlay.kind).toBe("gate");
    });
  });

  describe("pattern matching", () => {
    it("redacts matches with the default '[REDACTED]'", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "email", pattern: "\\S+@\\S+\\.\\S+" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, {
          content: [
            { type: "text", text: "contact us at alice@example.com today" },
          ],
        }),
        ctx,
      );

      expect(result).toMatchObject({
        forward: {
          result: {
            content: [{ text: "contact us at [REDACTED] today" }],
          },
        },
      });
    });

    it("uses a rule-specific replacement when set", () => {
      const overlay = createRedactOverlay({
        rules: [
          { name: "email", pattern: "\\S+@\\S+", replacement: "[EMAIL]" },
        ],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, "alice@example.com"),
        ctx,
      );

      expect(result).toMatchObject({ forward: { result: "[EMAIL]" } });
    });

    it("falls back to defaultReplacement when a rule has none", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret" }],
        defaultReplacement: "***",
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, "the secret is hidden"),
        ctx,
      );

      expect(result).toMatchObject({ forward: { result: "the *** is hidden" } });
    });

    it("applies multiple rules to the same response", () => {
      const overlay = createRedactOverlay({
        rules: [
          { name: "email", pattern: "\\S+@\\S+", replacement: "[E]" },
          { name: "digits", pattern: "\\d+", replacement: "[N]" },
        ],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, "alice@example.com is 30"),
        ctx,
      );

      expect(result).toMatchObject({ forward: { result: "[E] is [N]" } });
    });

    it("returns undefined when nothing matches", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "email", pattern: "\\S+@\\S+" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, "no email here"),
        ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("recursion", () => {
    it("recurses into nested objects", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, { a: { b: { c: "the secret is here" } } }),
        ctx,
      );

      expect(result).toMatchObject({
        forward: { result: { a: { b: { c: "the *** is here" } } } },
      });
    });

    it("recurses into arrays", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, {
          content: ["plain", "the secret is here", "plain again"],
        }),
        ctx,
      );

      expect(result).toMatchObject({
        forward: {
          result: { content: ["plain", "the *** is here", "plain again"] },
        },
      });
    });

    it("does not touch non-string values", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "digits", pattern: "\\d+", replacement: "[N]" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, { count: 42, ok: true, missing: null }),
        ctx,
      );

      expect(result).toBeUndefined();
    });

    it("does not redact field names, only string values", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, { secret: "value" }),
        ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("scope (tools/call only)", () => {
    it("does NOT redact an initialize response (protocol-version regression)", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "digits", pattern: "\\d+", replacement: "[N]" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        ctx,
      );

      const result = overlay.onServerMessage!(
        successReply(1, { protocolVersion: "2024-11-05" }),
        ctx,
      );

      expect(result).toBeUndefined();
    });

    it("does NOT redact a tools/list response", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "delete", pattern: "delete", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsListRequest(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, {
          tools: [{ name: "delete_db", description: "delete the database" }],
        }),
        ctx,
      );

      expect(result).toBeUndefined();
    });

    it("does NOT redact error responses, even for tracked ids", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        errorReply(1, -32601, "secret method not found"),
        ctx,
      );

      expect(result).toBeUndefined();
    });

    it("does NOT redact responses to ids it never tracked", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();

      const result = overlay.onServerMessage!(
        successReply(99, "the secret is here"),
        ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("cleanup", () => {
    it("redacts each tools/call response only once (clears tracking)", () => {
      const overlay = createRedactOverlay({
        rules: [{ name: "secret", pattern: "secret", replacement: "***" }],
      });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const first = overlay.onServerMessage!(
        successReply(1, "the secret"),
        ctx,
      );
      const second = overlay.onServerMessage!(
        successReply(1, "the secret"),
        ctx,
      );

      expect(first).toMatchObject({ forward: { result: "the ***" } });
      expect(second).toBeUndefined();
    });
  });

  describe("empty rules", () => {
    it("returns undefined when no rules are configured", () => {
      const overlay = createRedactOverlay({ rules: [] });
      const ctx = makeCtx();
      overlay.onClientMessage!(toolsCall(1), ctx);

      const result = overlay.onServerMessage!(
        successReply(1, "any string at all"),
        ctx,
      );

      expect(result).toBeUndefined();
    });
  });
});
