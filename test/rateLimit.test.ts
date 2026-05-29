import { describe, it, expect } from "vitest";
import { createRateLimitOverlay } from "../src/overlays/rateLimit.js";
import type { OverlayContext } from "../src/pipeline.js";
import type { JsonRpcMessage } from "../src/rpc.js";

function makeCtx(): OverlayContext {
  return { log: () => {}, state: {} };
}

function call(id: number, name: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} },
  };
}

// A controllable clock: starts at 0, advanced by tick().
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

function isAllowed(result: unknown): boolean {
  return result === undefined;
}

function isThrottled(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "respond" in result &&
    (result as { respond: { error?: { code?: number } } }).respond.error
      ?.code === -32000
  );
}

describe("createRateLimitOverlay", () => {
  describe("metadata", () => {
    it("has name 'rateLimit' and kind 'gate'", () => {
      const overlay = createRateLimitOverlay([]);
      expect(overlay.name).toBe("rateLimit");
      expect(overlay.kind).toBe("gate");
    });
  });

  describe("scope", () => {
    it("ignores non-tools/call requests", () => {
      const overlay = createRateLimitOverlay([{ tool: "*", perMinute: 1 }]);
      const result = overlay.onClientMessage!(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        makeCtx(),
      );
      expect(isAllowed(result)).toBe(true);
    });

    it("ignores notifications (no id)", () => {
      const overlay = createRateLimitOverlay([{ tool: "*", perMinute: 1 }]);
      const result = overlay.onClientMessage!(
        { jsonrpc: "2.0", method: "tools/call", params: { name: "x" } },
        makeCtx(),
      );
      expect(isAllowed(result)).toBe(true);
    });

    it("allows tools that match no rule", () => {
      const overlay = createRateLimitOverlay([{ tool: "search", perMinute: 1 }]);
      const ctx = makeCtx();
      // "other" matches nothing, so it is never throttled however many times.
      for (let i = 0; i < 10; i++) {
        expect(isAllowed(overlay.onClientMessage!(call(i, "other"), ctx))).toBe(
          true,
        );
      }
    });
  });

  describe("bucket capacity & exhaustion", () => {
    it("allows up to capacity, then throttles with -32000", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "search", perMinute: 3 }],
        clock.now,
      );
      const ctx = makeCtx();
      // capacity = max(3, 1) = 3
      expect(isAllowed(overlay.onClientMessage!(call(1, "search"), ctx))).toBe(true);
      expect(isAllowed(overlay.onClientMessage!(call(2, "search"), ctx))).toBe(true);
      expect(isAllowed(overlay.onClientMessage!(call(3, "search"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(4, "search"), ctx))).toBe(true);
    });

    it("capacity floors at 1 even when perMinute < 1", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "search", perMinute: 0.5 }],
        clock.now,
      );
      const ctx = makeCtx();
      expect(isAllowed(overlay.onClientMessage!(call(1, "search"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(2, "search"), ctx))).toBe(true);
    });

    it("includes tool, rule, rate, and retry-after in the error", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "search", perMinute: 60 }],
        clock.now,
      );
      const ctx = makeCtx();
      overlay.onClientMessage!(call(1, "search"), ctx); // drains to capacity-1
      // drain the rest (capacity 60)
      for (let i = 0; i < 60; i++) overlay.onClientMessage!(call(i, "search"), ctx);
      const result = overlay.onClientMessage!(call(99, "search"), ctx);
      const msg = (result as { respond: { error: { message: string } } })
        .respond.error.message;
      expect(msg).toContain("search");
      expect(msg).toContain("60/min");
      expect(msg).toMatch(/retry after ~\d+s/);
    });
  });

  describe("refill over time", () => {
    it("refills tokens as time passes", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "search", perMinute: 60 }], // 1 token/sec, capacity 60
        clock.now,
      );
      const ctx = makeCtx();
      // Drain all 60 tokens.
      for (let i = 0; i < 60; i++)
        expect(isAllowed(overlay.onClientMessage!(call(i, "search"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(61, "search"), ctx))).toBe(true);

      // After 1 second, 1 token refills (60/min = 1/sec).
      clock.tick(1000);
      expect(isAllowed(overlay.onClientMessage!(call(62, "search"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(63, "search"), ctx))).toBe(true);
    });

    it("never refills beyond capacity", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "search", perMinute: 2 }],
        clock.now,
      );
      const ctx = makeCtx();
      overlay.onClientMessage!(call(1, "search"), ctx);
      overlay.onClientMessage!(call(2, "search"), ctx);
      expect(isThrottled(overlay.onClientMessage!(call(3, "search"), ctx))).toBe(true);
      // Wait a long time — bucket should cap at capacity (2), not accumulate.
      clock.tick(10 * 60 * 1000);
      expect(isAllowed(overlay.onClientMessage!(call(4, "search"), ctx))).toBe(true);
      expect(isAllowed(overlay.onClientMessage!(call(5, "search"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(6, "search"), ctx))).toBe(true);
    });
  });

  describe("per-tool isolation (FR-RATE-010)", () => {
    it("keeps separate buckets per tool name under a glob rule", () => {
      const clock = fakeClock();
      const overlay = createRateLimitOverlay(
        [{ tool: "*", perMinute: 1 }],
        clock.now,
      );
      const ctx = makeCtx();
      // Each distinct tool gets its own bucket of capacity 1.
      expect(isAllowed(overlay.onClientMessage!(call(1, "alpha"), ctx))).toBe(true);
      expect(isAllowed(overlay.onClientMessage!(call(2, "beta"), ctx))).toBe(true);
      // Second hit on each tool is throttled independently.
      expect(isThrottled(overlay.onClientMessage!(call(3, "alpha"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(4, "beta"), ctx))).toBe(true);
    });
  });

  describe("multiple matching rules", () => {
    it("applies the tightest matching rule and isolates other tools", () => {
      const clock = fakeClock();
      // Two rules both match "search": a tight one (1/min) and a loose one.
      const overlay = createRateLimitOverlay(
        [
          { tool: "search", perMinute: 1 },
          { tool: "*", perMinute: 100 },
        ],
        clock.now,
      );
      const ctx = makeCtx();
      // First call passes both buckets.
      expect(isAllowed(overlay.onClientMessage!(call(1, "search"), ctx))).toBe(true);
      // Second "search" is throttled by the tight 1/min rule, even though the
      // loose 100/min rule still has tokens.
      expect(isThrottled(overlay.onClientMessage!(call(2, "search"), ctx))).toBe(true);
      // A different tool only matches "*", so it keeps its own full allowance —
      // search's throttle does not bleed into it.
      for (let i = 0; i < 100; i++)
        expect(isAllowed(overlay.onClientMessage!(call(i, "other"), ctx))).toBe(true);
      expect(isThrottled(overlay.onClientMessage!(call(999, "other"), ctx))).toBe(true);
    });
  });
});
