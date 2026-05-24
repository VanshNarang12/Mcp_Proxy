import { describe, it, expect } from "vitest";
import { createBlockOverlay } from "../src/overlays/block.js";
import type { OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

function makeCtx(): OverlayContext {
  return {
    log: () => {},
    state: {},
  };
}

function toolsCall(id: number, name: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} },
  };
}

function toolsListReply(
  id: number,
  tools: Array<{ name: string }>,
): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    result: { tools },
  };
}

describe("createBlockOverlay", () => {
  describe("onClientMessage (tools/call)", () => {
    it("blocks an exact-name match with -32601", () => {
      const overlay = createBlockOverlay({ tools: ["delete_db"] });
      const result = overlay.onClientMessage!(
        toolsCall(7, "delete_db"),
        makeCtx(),
      );
      expect(result).toMatchObject({
        respond: {
          jsonrpc: "2.0",
          id: 7,
          error: { code: -32601 },
        },
      });
    });

    it("lets a non-matching call through (returns undefined)", () => {
      const overlay = createBlockOverlay({ tools: ["delete_*"] });
      const result = overlay.onClientMessage!(
        toolsCall(1, "add"),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks tool names matching a glob pattern", () => {
      const overlay = createBlockOverlay({ tools: ["delete_*"] });
      const result = overlay.onClientMessage!(
        toolsCall(2, "delete_users"),
        makeCtx(),
      );
      expect(result).toMatchObject({
        respond: { error: { code: -32601 } },
      });
    });

    it("ignores requests with a method other than tools/call", () => {
      const overlay = createBlockOverlay({ tools: ["delete_db"] });
      const result = overlay.onClientMessage!(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "initialize",
          params: {},
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores tools/call requests with no string name in params", () => {
      const overlay = createBlockOverlay({ tools: ["x"] });
      const result = overlay.onClientMessage!(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { arguments: {} },
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("preserves the request id in the error response", () => {
      const overlay = createBlockOverlay({ tools: ["bad"] });
      const result = overlay.onClientMessage!(
        toolsCall(123, "bad"),
        makeCtx(),
      );
      expect(result).toMatchObject({ respond: { id: 123 } });
    });
  });

  describe("onServerMessage (tools/list)", () => {
    it("filters a blocked tool out of the list", () => {
      const overlay = createBlockOverlay({ tools: ["delete_db"] });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [
          { name: "add" },
          { name: "delete_db" },
          { name: "ping" },
        ]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          result: { tools: [{ name: "add" }, { name: "ping" }] },
        },
      });
    });

    it("filters multiple tools matching a glob pattern", () => {
      const overlay = createBlockOverlay({ tools: ["delete_*"] });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [
          { name: "add" },
          { name: "delete_users" },
          { name: "delete_logs" },
        ]),
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: { result: { tools: [{ name: "add" }] } },
      });
    });

    it("returns undefined when nothing in the list matches", () => {
      const overlay = createBlockOverlay({ tools: ["delete_*"] });
      const result = overlay.onServerMessage!(
        toolsListReply(1, [{ name: "add" }, { name: "ping" }]),
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores success responses that don't have a tools array", () => {
      const overlay = createBlockOverlay({ tools: ["add"] });
      const result = overlay.onServerMessage!(
        {
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: "ok" }] },
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("ignores error responses", () => {
      const overlay = createBlockOverlay({ tools: ["add"] });
      const result = overlay.onServerMessage!(
        {
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32603, message: "boom" },
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("preserves other fields in the reply (id, jsonrpc, sibling result fields)", () => {
      const overlay = createBlockOverlay({ tools: ["delete_db"] });
      const result = overlay.onServerMessage!(
        {
          jsonrpc: "2.0",
          id: 99,
          result: {
            tools: [{ name: "add" }, { name: "delete_db" }],
            nextCursor: "page2",
          },
        },
        makeCtx(),
      );
      expect(result).toMatchObject({
        forward: {
          jsonrpc: "2.0",
          id: 99,
          result: {
            tools: [{ name: "add" }],
            nextCursor: "page2",
          },
        },
      });
    });
  });

  describe("pattern matching", () => {
    it("plain names match exactly, not as prefixes", () => {
      const overlay = createBlockOverlay({ tools: ["add"] });
      expect(
        overlay.onClientMessage!(toolsCall(1, "add"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(2, "add_two"), makeCtx()),
      ).toBeUndefined();
    });

    it("* at the end matches any suffix (including empty)", () => {
      const overlay = createBlockOverlay({ tools: ["admin_*"] });
      expect(
        overlay.onClientMessage!(toolsCall(1, "admin_users"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(2, "admin_"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(3, "user_admin"), makeCtx()),
      ).toBeUndefined();
    });

    it("* in the middle matches anything between", () => {
      const overlay = createBlockOverlay({ tools: ["a*z"] });
      expect(
        overlay.onClientMessage!(toolsCall(1, "abz"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(2, "az"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(3, "ab"), makeCtx()),
      ).toBeUndefined();
    });

    it("blocks if any one of multiple patterns matches", () => {
      const overlay = createBlockOverlay({ tools: ["a*", "x"] });
      expect(
        overlay.onClientMessage!(toolsCall(1, "apple"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(2, "x"), makeCtx()),
      ).toBeDefined();
      expect(
        overlay.onClientMessage!(toolsCall(3, "y"), makeCtx()),
      ).toBeUndefined();
    });

    it("an empty pattern list blocks nothing", () => {
      const overlay = createBlockOverlay({ tools: [] });
      expect(
        overlay.onClientMessage!(toolsCall(1, "anything"), makeCtx()),
      ).toBeUndefined();
      expect(
        overlay.onServerMessage!(
          toolsListReply(2, [{ name: "add" }]),
          makeCtx(),
        ),
      ).toBeUndefined();
    });
  });
});
