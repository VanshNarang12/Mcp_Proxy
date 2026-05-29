import { describe, it, expect } from "vitest";
import { createInstructionsOverlay } from "../src/overlays/instructions.js";
import type { OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

function makeCtx(): OverlayContext {
  return { log: () => {}, state: {} };
}

function toolsListReply(
  id: number,
  tools: Array<{ name: string; description?: string }>,
): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result: { tools } };
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

describe("createInstructionsOverlay", () => {
  describe("metadata", () => {
    it("has name 'instructions' and kind 'observer'", () => {
      const overlay = createInstructionsOverlay({ rules: [] });
      expect(overlay.name).toBe("instructions");
      expect(overlay.kind).toBe("observer");
    });
  });

  describe("rule application", () => {
    it("prepends to a matching tool's description", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", prepend: "[SAFE] " }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "find things" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          result: {
            tools: [{ name: "search", description: "[SAFE] find things" }],
          },
        },
      });
    });

    it("appends to a matching tool's description", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", append: " (rate limited)" }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "find things" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          result: {
            tools: [
              { name: "search", description: "find things (rate limited)" },
            ],
          },
        },
      });
    });

    it("replaces a matching tool's description entirely", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", replace: "Use only with approval." }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "find things" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          result: {
            tools: [
              { name: "search", description: "Use only with approval." },
            ],
          },
        },
      });
    });

    it("replace takes precedence over prepend/append", () => {
      const overlay = createInstructionsOverlay({
        rules: [
          { tool: "search", prepend: "A", append: "B", replace: "ONLY" },
        ],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "orig" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: { result: { tools: [{ description: "ONLY" }] } },
      });
    });

    it("prepend and append combine on the same tool", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", prepend: "[", append: "]" }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "x" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: { result: { tools: [{ description: "[x]" }] } },
      });
    });

    it("treats a missing description as empty string", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", append: "appended" }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: { result: { tools: [{ description: "appended" }] } },
      });
    });
  });

  describe("matching", () => {
    it("supports '*' wildcards in the tool pattern", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "delete_*", prepend: "[DANGER] " }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [
          { name: "delete_db", description: "drop it" },
          { name: "read_db", description: "read it" },
        ]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          result: {
            tools: [
              { name: "delete_db", description: "[DANGER] drop it" },
              { name: "read_db", description: "read it" },
            ],
          },
        },
      });
    });

    it("leaves non-matching tools untouched", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", prepend: "[X] " }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "other", description: "keep me" }]),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("applies the first matching rule per tool", () => {
      const overlay = createInstructionsOverlay({
        rules: [
          { tool: "*", prepend: "first " },
          { tool: "search", prepend: "second " },
        ],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "x" }]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: { result: { tools: [{ description: "first x" }] } },
      });
    });
  });

  describe("no-op cases", () => {
    it("returns undefined when no rules are configured", () => {
      const overlay = createInstructionsOverlay({ rules: [] });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "x" }]),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined when the rewrite changes nothing", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "search", replace: "same" }],
      });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "search", description: "same" }]),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });
  });

  describe("scope (tools/list only)", () => {
    it("ignores an initialize response (protocol-version safety)", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "*", replace: "rewritten" }],
      });
      const result = overlay.onServerMessage!(
        successReply(1, { protocolVersion: "2024-11-05" }),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores a tools/call result that is not a tools list", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "*", prepend: "[X] " }],
      });
      const result = overlay.onServerMessage!(
        successReply(1, { content: [{ type: "text", text: "hello" }] }),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores error responses", () => {
      const overlay = createInstructionsOverlay({
        rules: [{ tool: "*", prepend: "[X] " }],
      });
      const result = overlay.onServerMessage!(
        errorReply(1, -32601, "method not found"),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });
  });
});
