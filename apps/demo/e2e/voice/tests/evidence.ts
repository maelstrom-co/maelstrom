import type { ConsoleMessage, Page, WebSocket } from '@playwright/test';

// Caption wording is supporting evidence, not the application-success oracle.
export const CALENDAR_WORD = /\bcalendar\b/i;
export const TASK_WORD = /\btasks?\b/i;

const PROTOCOL_FAILURE =
  /decodeClientEnvelope|Tiling tree leaf .+ is not declared in layout\.instances/;
const LIMIT = 40;
const MAX_FRAME_BYTES = 1_048_576;
const text = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, 256) : null;
const ids = (instances: unknown) =>
  Array.isArray(instances)
    ? instances.slice(0, 128).map((instance) => text(instance?.instanceId))
    : [];

// Deliberately exclude intentions, vessel descriptions, response bodies,
// credentials, hello/auth payloads, and all non-chart messages.
export function projectChartRequest(payload: unknown) {
  const encoded = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  if (
    typeof encoded !== 'string' ||
    Buffer.byteLength(encoded) > MAX_FRAME_BYTES
  )
    return null;
  let envelope: {
    type?: unknown;
    id?: unknown;
    request?: {
      layout?: { type?: unknown; tree?: unknown; instances?: unknown };
      context?: { layoutMode?: unknown };
      instances?: unknown;
    };
  };
  try {
    envelope = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (envelope?.type !== 'chart_request') return null;
  const request = envelope.request;
  const layout = request?.layout;
  if (!request || !layout) return null;
  return {
    messageId: text(envelope.id),
    layoutMode: text(request.context?.layoutMode),
    layoutType: text(layout.type),
    tree: Array.isArray(layout.tree)
      ? layout.tree.slice(0, 128).map(text)
      : undefined,
    declaredInstanceIds: ids(layout.instances),
    currentInstanceIds: ids(request.instances),
  };
}

export function observeProtocol(page: Page) {
  const failures: Array<{ elapsedMs: number; message: string }> = [];
  const requests: Array<{
    elapsedMs: number;
    messageId: string | null;
    layoutMode: string | null;
    layoutType: string | null;
    tree: (string | null)[] | undefined;
    declaredInstanceIds: (string | null)[];
    currentInstanceIds: (string | null)[];
  }> = [];
  const sockets = new Map<
    WebSocket,
    (event: { payload: string | Buffer }) => void
  >();
  const started = performance.now();
  const at = () => Math.round(performance.now() - started);
  const onConsole = (message: ConsoleMessage) => {
    const value = message.text();
    if (
      message.type() === 'error' &&
      PROTOCOL_FAILURE.test(value) &&
      failures.length < LIMIT
    ) {
      failures.push({ elapsedMs: at(), message: value.slice(0, 1600) });
    }
  };
  const onSocket = (socket: WebSocket) => {
    let url: URL | undefined;
    try {
      url = new URL(socket.url());
    } catch {
      return;
    }
    if (url.pathname !== '/ws') return;
    const onFrame = (event: { payload: string | Buffer }) => {
      const request = projectChartRequest(event.payload);
      if (request && requests.length < LIMIT)
        requests.push({ elapsedMs: at(), ...request });
    };
    sockets.set(socket, onFrame);
    socket.on('framesent', onFrame);
  };
  page.on('console', onConsole);
  page.on('websocket', onSocket);
  return {
    assertHealthy(phase: string, cause?: unknown) {
      if (failures.length) {
        throw new Error(
          `Maelstrom rejected a chart request during ${phase}: ${failures[0].message}. ` +
            'See protocol-evidence.json and before-cleanup.png. Check browser/server protocol builds; ' +
            'do not treat this as a microphone failure.',
          cause === undefined ? undefined : { cause },
        );
      }
    },
    snapshot() {
      return { failures: [...failures], requests: [...requests] };
    },
    dispose() {
      page.off('console', onConsole);
      page.off('websocket', onSocket);
      for (const [socket, handler] of sockets) socket.off('framesent', handler);
      sockets.clear();
    },
  };
}
