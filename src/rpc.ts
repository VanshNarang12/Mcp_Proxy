import { EventEmitter } from "node:events";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerError: -32000,
} as const;

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return (
    "method" in msg &&
    "id" in msg &&
    (msg as { id?: unknown }).id !== undefined &&
    (msg as { id?: unknown }).id !== null
  );
}

export function isNotification(
  msg: JsonRpcMessage,
): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

export function isSuccess(msg: JsonRpcMessage): msg is JsonRpcSuccessResponse {
  return isResponse(msg) && "result" in msg;
}

export function isErrorResponse(
  msg: JsonRpcMessage,
): msg is JsonRpcErrorResponse {
  return isResponse(msg) && "error" in msg;
}

export function makeErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

export function encodeFrame(msg: JsonRpcMessage): Buffer {
  return Buffer.from(JSON.stringify(msg) + "\n", "utf8");
}

export class FrameDecoder extends EventEmitter {
  private buffer = "";
  private readonly textDecoder = new TextDecoder("utf-8");

  push(chunk: Buffer | string): void {
    const text =
      typeof chunk === "string"
        ? chunk
        : this.textDecoder.decode(chunk, { stream: true });
    this.buffer += text;

    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      this.handleLine(line);
      newlineIdx = this.buffer.indexOf("\n");
    }
  }

  end(): void {
    const tail = this.textDecoder.decode();
    this.buffer += tail;
    if (this.buffer.length > 0) {
      this.handleLine(this.buffer);
      this.buffer = "";
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      const parsed = JSON.parse(trimmed) as JsonRpcMessage;
      this.emit("message", parsed);
    } catch (err) {
      this.emit("malformed", trimmed, err);
    }
  }
}

export interface FrameDecoder {
  on(event: "message", listener: (msg: JsonRpcMessage) => void): this;
  on(event: "malformed", listener: (line: string, err: unknown) => void): this;
  once(event: "message", listener: (msg: JsonRpcMessage) => void): this;
  once(event: "malformed", listener: (line: string, err: unknown) => void): this;
  emit(event: "message", msg: JsonRpcMessage): boolean;
  emit(event: "malformed", line: string, err: unknown): boolean;
}
