import { describe, it, expect } from "vitest";
import { FrameDecoder, type JsonRpcMessage } from "../src/rpc.js";

function collect(decoder: FrameDecoder) {
  const messages: JsonRpcMessage[] = [];
  const malformed: Array<{ line: string; err: unknown }> = [];
  decoder.on("message", (m) => messages.push(m));
  decoder.on("malformed", (line, err) => malformed.push({ line, err }));
  return { messages, malformed };
}

describe("FrameDecoder", () => {
  describe("happy path", () => {
    it("emits a single message for a complete frame", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
      expect(malformed).toHaveLength(0);
    });

    it("emits both messages when two frames arrive in one push", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push(
        '{"jsonrpc":"2.0","id":1,"method":"a"}\n' +
          '{"jsonrpc":"2.0","id":2,"method":"b"}\n',
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ id: 1, method: "a" });
      expect(messages[1]).toMatchObject({ id: 2, method: "b" });
      expect(malformed).toHaveLength(0);
    });

    it("accepts Buffer input the same as string input", () => {
      const decoder = new FrameDecoder();
      const { messages } = collect(decoder);

      const frame = '{"jsonrpc":"2.0","id":1,"result":42}\n';
      decoder.push(Buffer.from(frame, "utf8"));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ jsonrpc: "2.0", id: 1, result: 42 });
    });
  });

  describe("partial frames", () => {
    it("waits for the newline before emitting", () => {
      const decoder = new FrameDecoder();
      const { messages } = collect(decoder);

      decoder.push('{"jsonrpc":"2.0","id":1,"method":"pi');
      expect(messages).toHaveLength(0);

      decoder.push('ng"}\n');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: 1, method: "ping" });
    });

    it("buffers across many one-character pushes until newline", () => {
      const decoder = new FrameDecoder();
      const { messages } = collect(decoder);

      const frame = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
      for (const ch of frame) {
        decoder.push(ch);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: 1, method: "ping" });
    });

    it("emits a final unterminated frame on end()", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      expect(messages).toHaveLength(0);

      decoder.end();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: 1, method: "ping" });
      expect(malformed).toHaveLength(0);
    });

    it("does not emit anything on end() when the buffer is already empty", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
      decoder.end();

      expect(messages).toHaveLength(1);
      expect(malformed).toHaveLength(0);
    });
  });

  describe("empty and whitespace lines", () => {
    it("silently skips empty lines between frames", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push(
        '{"jsonrpc":"2.0","id":1,"method":"a"}\n' +
          "\n" +
          '{"jsonrpc":"2.0","id":2,"method":"b"}\n',
      );

      expect(messages).toHaveLength(2);
      expect(malformed).toHaveLength(0);
    });

    it("silently skips whitespace-only lines", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push("   \t  \n");
      decoder.push('{"jsonrpc":"2.0","id":1,"method":"x"}\n');

      expect(messages).toHaveLength(1);
      expect(malformed).toHaveLength(0);
    });
  });

  describe("malformed input", () => {
    it("emits 'malformed' on invalid JSON without crashing", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push("this is not json\n");

      expect(messages).toHaveLength(0);
      expect(malformed).toHaveLength(1);
      expect(malformed[0].line).toBe("this is not json");
      expect(malformed[0].err).toBeInstanceOf(SyntaxError);
    });

    it("recovers and processes subsequent valid frames after a malformed one", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      decoder.push('garbage\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

      expect(malformed).toHaveLength(1);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: 1, method: "ping" });
    });
  });

  describe("UTF-8 across chunk boundaries", () => {
    it("does not corrupt a multi-byte character split between two Buffer pushes", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      const frame = '{"jsonrpc":"2.0","id":1,"result":"hello 🚀"}\n';
      const buf = Buffer.from(frame, "utf8");

      // 🚀 (U+1F680) encodes as 4 UTF-8 bytes (F0 9F 9A 80).
      // Split the buffer 2 bytes into the emoji so the second half
      // arrives in the next push.
      const prefix = '{"jsonrpc":"2.0","id":1,"result":"hello ';
      const splitAt = Buffer.byteLength(prefix, "utf8") + 2;

      decoder.push(buf.subarray(0, splitAt));
      expect(messages).toHaveLength(0);

      decoder.push(buf.subarray(splitAt));

      expect(malformed).toHaveLength(0);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "hello 🚀",
      });
    });

    it("handles a frame pushed one byte at a time, including multi-byte characters", () => {
      const decoder = new FrameDecoder();
      const { messages, malformed } = collect(decoder);

      const frame = '{"jsonrpc":"2.0","id":1,"result":"héllo 世界 🚀"}\n';
      const buf = Buffer.from(frame, "utf8");

      for (let i = 0; i < buf.length; i++) {
        decoder.push(buf.subarray(i, i + 1));
      }

      expect(malformed).toHaveLength(0);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: "héllo 世界 🚀",
      });
    });
  });
});
