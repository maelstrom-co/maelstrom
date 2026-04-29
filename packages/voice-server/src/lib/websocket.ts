type WebSocketHeaders = Record<string, string>;

interface BunWebSocketOptions {
  headers?: WebSocketHeaders;
}

declare global {
  // WHY: This package targets Node and Bun-compatible runtimes without shipping the DOM lib as part of
  // its public type surface. Declaring the minimal websocket/event shapes locally keeps provider code
  // type-safe while avoiding a dependency on browser ambient types for every consumer.
  interface Event {}

  interface MessageEvent<T = unknown> {
    readonly data: T;
  }

  interface CloseEvent {
    readonly code: number;
    readonly reason: string;
  }

  interface WebSocket {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    readonly readyState: number;
    send(data: string | ArrayBufferLike | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
  }

  interface WebSocketConstructor {
    readonly OPEN: number;
    new (url: string | URL, options?: BunWebSocketOptions): WebSocket;
  }

  var WebSocket: WebSocketConstructor;
}

interface BunWebSocketConstructor {
  new (url: string | URL, options?: BunWebSocketOptions): WebSocket;
}

export function createWebSocket(
  url: string | URL,
  options?: BunWebSocketOptions,
): WebSocket {
  // WHY: We resolve the constructor from `globalThis` at call time so the package works in Bun and in
  // test environments that install a compatible WebSocket globally, without freezing in one runtime
  // implementation at module load.
  const BunCompatibleWebSocket = (
    globalThis as typeof globalThis & {
      WebSocket: BunWebSocketConstructor;
    }
  ).WebSocket;

  return new BunCompatibleWebSocket(url, options);
}
