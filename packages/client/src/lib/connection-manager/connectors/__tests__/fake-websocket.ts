/**
 * Minimal in-memory WebSocket fake for connector tests.
 *
 * The connectors construct `new WebSocket(url)` against the global. Each test
 * installs `FakeWebSocket` as `globalThis.WebSocket`, exercises the connector,
 * and uses the captured instance to assert sent payloads or trigger events.
 */

type Listener = (event: unknown) => void;

export class FakeWebSocket {
  // Mirrors the four DOM-lib readyState values so tests asserting any of
  // them land on the right number rather than `undefined`.
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  url: string;

  /** Captures every JSON / binary frame sent via `.send()`. */
  readonly sent: unknown[] = [];

  /**
   * Status code passed to each `.close(code)` call, `undefined` for a bare
   * `close()`. Lets a test assert the code the connector actually requested
   * instead of only the code the test itself hands back via `emitClose()` —
   * the two are independent, and a fabricated close code proves nothing
   * about what the browser would have reported.
   */
  readonly closeCodes: (number | undefined)[] = [];

  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  /** Test helper: open the socket so the connector's connect() resolves. */
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#dispatch('open', {});
  }

  /** Test helper: deliver a JSON payload to the connector's onmessage. */
  emitJson(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper: deliver a binary frame. */
  emitBinary(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }

  /** Test helper: close the socket. */
  emitClose(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closeCodes.push(code);
    this.readyState = FakeWebSocket.CLOSED;
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.#listeners.get(type)?.delete(fn);
  }

  #dispatch(type: string, event: unknown): void {
    this.#listeners.get(type)?.forEach((fn) => {
      fn(event);
    });
  }
}

/**
 * Replace `globalThis.WebSocket` for the duration of a test. Returns a
 * teardown function that restores the original constructor.
 */
export function installFakeWebSocket(): () => void {
  const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  return () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = previous;
    FakeWebSocket.instances = [];
  };
}
