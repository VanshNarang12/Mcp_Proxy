import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuditOverlay,
  type AuditConfig,
} from "../src/overlays/audit.js";
import type { Overlay, OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-audit-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(): OverlayContext {
  return { log: () => {}, state: {} };
}

function toolsCall(id: number, name: string, args?: unknown): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  };
}

function successReply(id: number, result?: unknown): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    result: result ?? { content: [{ type: "text", text: "ok" }] },
  };
}

function errorReply(
  id: number,
  code: number,
  message: string,
): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

async function captureLog(
  config: AuditConfig,
  fn: (overlay: Overlay, ctx: OverlayContext) => void,
): Promise<Record<string, unknown>[]> {
  const overlay = createAuditOverlay(config);
  const ctx = makeCtx();
  await overlay.setup!(ctx);
  fn(overlay, ctx);
  await overlay.teardown!(ctx);
  const raw = readFileSync(config.sink, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("createAuditOverlay", () => {
  describe("metadata", () => {
    it("has name 'audit' and kind 'observer'", () => {
      const overlay = createAuditOverlay({ sink: join(tmpDir, "x.log") });
      expect(overlay.name).toBe("audit");
      expect(overlay.kind).toBe("observer");
    });
  });

  describe("lifecycle", () => {
    it("creates the sink file on setup, even with zero events", async () => {
      const sink = join(tmpDir, "empty.log");
      const lines = await captureLog({ sink }, () => {
        // no events
      });
      expect(lines).toHaveLength(0);
      // readFileSync above would have thrown if the file wasn't created
      expect(readFileSync(sink, "utf8")).toBe("");
    });
  });

  describe("onClientMessage", () => {
    it("writes one line for a tools/call request", async () => {
      const sink = join(tmpDir, "client.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add", { a: 5, b: 6 }), ctx);
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        direction: "client",
        method: "tools/call",
        id: 1,
        toolName: "add",
        outcome: "request",
      });
      expect(typeof lines[0].timestamp).toBe("string");
      expect(typeof lines[0].argsHash).toBe("string");
    });

    it("hashes args by default and omits raw args", async () => {
      const sink = join(tmpDir, "hash.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add", { a: 5, b: 6 }), ctx);
      });
      expect(lines[0]).not.toHaveProperty("args");
      expect(lines[0].argsHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("includes raw args when logRawArgs is true", async () => {
      const sink = join(tmpDir, "raw.log");
      const lines = await captureLog(
        { sink, logRawArgs: true },
        (overlay, ctx) => {
          overlay.onClientMessage!(toolsCall(1, "add", { a: 5, b: 6 }), ctx);
        },
      );
      expect(lines[0].args).toEqual({ a: 5, b: 6 });
    });

    it("includes identity when configured", async () => {
      const sink = join(tmpDir, "id.log");
      const lines = await captureLog(
        { sink, identity: { user: "alice", machine: "laptop" } },
        (overlay, ctx) => {
          overlay.onClientMessage!(toolsCall(1, "add"), ctx);
        },
      );
      expect(lines[0].identity).toEqual({ user: "alice", machine: "laptop" });
    });

    it("does not log non-tools/call requests", async () => {
      const sink = join(tmpDir, "skip.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(
          { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
          ctx,
        );
        overlay.onClientMessage!(
          { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
          ctx,
        );
      });
      expect(lines).toHaveLength(0);
    });

    it("produces the same hash for identical args", async () => {
      const sink = join(tmpDir, "consistent.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add", { a: 1 }), ctx);
        overlay.onClientMessage!(toolsCall(2, "add", { a: 1 }), ctx);
      });
      expect(lines[0].argsHash).toBe(lines[1].argsHash);
    });

    it("produces different hashes for different args", async () => {
      const sink = join(tmpDir, "diff.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add", { a: 1 }), ctx);
        overlay.onClientMessage!(toolsCall(2, "add", { a: 2 }), ctx);
      });
      expect(lines[0].argsHash).not.toBe(lines[1].argsHash);
    });
  });

  describe("onServerMessage", () => {
    it("writes a success line that pairs with the preceding request", async () => {
      const sink = join(tmpDir, "pair.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(7, "add", { a: 5, b: 6 }), ctx);
        overlay.onServerMessage!(successReply(7), ctx);
      });
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        direction: "client",
        id: 7,
        outcome: "request",
      });
      expect(lines[1]).toMatchObject({
        direction: "server",
        id: 7,
        toolName: "add",
        outcome: "success",
      });
      expect(typeof lines[1].durationMs).toBe("number");
    });

    it("writes an error line with code and message", async () => {
      const sink = join(tmpDir, "err.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(8, "add"), ctx);
        overlay.onServerMessage!(errorReply(8, -32601, "Tool not found"), ctx);
      });
      expect(lines[1]).toMatchObject({
        direction: "server",
        id: 8,
        outcome: "error",
        errorCode: -32601,
        errorMessage: "Tool not found",
      });
    });

    it("ignores a response to a request it never tracked", async () => {
      const sink = join(tmpDir, "untracked.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onServerMessage!(successReply(99), ctx);
      });
      expect(lines).toHaveLength(0);
    });

    it("only fires once per request (cleans up the pending map)", async () => {
      const sink = join(tmpDir, "once.log");
      const lines = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add"), ctx);
        overlay.onServerMessage!(successReply(1), ctx);
        // Duplicate reply for the same id — should NOT log again.
        overlay.onServerMessage!(successReply(1), ctx);
      });
      expect(lines).toHaveLength(2);
    });

    it("propagates identity onto the server line too", async () => {
      const sink = join(tmpDir, "id-server.log");
      const lines = await captureLog(
        { sink, identity: { user: "alice" } },
        (overlay, ctx) => {
          overlay.onClientMessage!(toolsCall(1, "add"), ctx);
          overlay.onServerMessage!(successReply(1), ctx);
        },
      );
      expect(lines[1].identity).toEqual({ user: "alice" });
    });
  });

  describe("appends rather than truncates", () => {
    it("two overlay sessions on the same sink accumulate lines", async () => {
      const sink = join(tmpDir, "append.log");

      await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(1, "add"), ctx);
      });
      const after = await captureLog({ sink }, (overlay, ctx) => {
        overlay.onClientMessage!(toolsCall(2, "add"), ctx);
      });

      // captureLog returns lines after the second session, but the file
      // contains BOTH sessions' lines because we open with flags: "a".
      expect(after).toHaveLength(2);
      expect(after[0]).toMatchObject({ id: 1 });
      expect(after[1]).toMatchObject({ id: 2 });
    });
  });
});
