import { createEngine } from '@maelstrom-co/engine';
import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentInputMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { createWebSocketHandlers, type SocketData } from './ws-server';

const chart = {
  type: 'chart_request' as const,
  context: {
    updateReasons: [],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: 'tiling' as const,
  },
  instances: [],
  vessels: [],
  layout: { type: 'tiling' as const, tree: [], instances: [] },
};
const frame = (
  input: Parameters<typeof AgentInputMessage>[0]['input'],
  sessionId = SessionId('streaming-demo'),
) => encodeEnvelope(AgentInputMessage({ sessionId, input }));
const utterance = () => ({
  type: 'utterance' as const,
  version: AGENT_WIRE_VERSION,
  inputId: MessageId('demo-input'),
  text: 'Keep the Chart empty',
  source: 'text' as const,
  chart,
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function socket() {
  const events: AgentEvent[] = [];
  const frames: string[] = [];
  return {
    data: { helloReceived: true } as SocketData,
    events,
    frames,
    send(wire: string) {
      frames.push(wire);
      const parsed = decodeServerEnvelope(wire);
      if (parsed.ok && parsed.value.type === 'engine.agent.event')
        events.push(parsed.value.event);
    },
    close() {},
  };
}

describe('local streaming WebSocket boundary', () => {
  it('streams UI-only events on the socket and completes only when its acknowledgement arrives', async () => {
    const engine = createEngine({
      retry: false,
      planner: async () =>
        ok({
          userMessage: 'The Chart is empty.',
          rationale: '',
          executionPlan: [],
          layout: { tree: [], instances: [] },
        }),
    });
    const handlers = createWebSocketHandlers({
      sharedEngine: engine,
      sharedEngineInitError: null,
    });
    const ws = socket();
    const client = ws as unknown as Parameters<typeof handlers.message>[0];
    await handlers.message(client, frame(utterance()));
    expect(ws.events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'ui_change',
    ]);
    const change = ws.events.find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    await handlers.message(
      client,
      frame({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        actionOutcomes: [],
      }),
    );
    expect(ws.events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'ui_change',
      'message',
      'finished',
    ]);
    handlers.close?.(client, 1000, 'done');
  });

  it('binds the socket to its session and closes in-flight work without sending a late layout', async () => {
    const entered = deferred();
    const gate = deferred();
    let signal: AbortSignal | undefined;
    const engine = createEngine({
      retry: false,
      planner: async (_input, context) => {
        signal = context.signal;
        entered.resolve();
        await gate.promise;
        return ok({
          userMessage: 'Late.',
          rationale: '',
          executionPlan: [],
          layout: { tree: [], instances: [] },
        });
      },
    });
    const handlers = createWebSocketHandlers({
      sharedEngine: engine,
      sharedEngineInitError: null,
    });
    const ws = socket();
    ws.data.sessionId = SessionId('streaming-demo');
    ws.data.browserApiKey = 'private-browser-key';
    ws.data.browserEngine = engine;
    const client = ws as unknown as Parameters<typeof handlers.message>[0];
    await handlers.message(
      client,
      frame(utterance(), SessionId('other-session')),
    );
    expect(ws.events).toHaveLength(0);
    const send = handlers.message(client, frame(utterance()));
    await entered.promise;
    handlers.close?.(client, 1000, 'done');
    gate.resolve();
    await send;
    expect(signal?.aborted).toBe(true);
    expect(ws.events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
    ]);
    await handlers.message(
      client,
      frame({ ...utterance(), inputId: MessageId('after-close') }),
    );
    expect(ws.data.agent).toBeUndefined();
    expect(ws.data.browserApiKey).toBeUndefined();
    expect(ws.data.browserEngine).toBeUndefined();
  });

  it('forwards run-owned diagnostics only for its session and content only after explicit opt-in', async () => {
    const engine = createEngine({
      retry: false,
      planner: async () =>
        ok({
          userMessage: 'Done.',
          rationale: '',
          executionPlan: [],
          layout: { tree: [], instances: [] },
        }),
    });
    const handlers = createWebSocketHandlers({
      sharedEngine: engine,
      sharedEngineInitError: null,
    });
    const ws = socket();
    ws.data.reportMetadata = true;
    const client = ws as unknown as Parameters<typeof handlers.message>[0];
    const subscribe = (includeContent: boolean) =>
      JSON.stringify({
        type: 'client.diagnostics.subscribe',
        id: 'subscription',
        sessionId: 'streaming-demo',
        enabled: true,
        includeContent,
      });
    try {
      await handlers.message(client, subscribe(false));
      await handlers.message(client, frame(utterance()));
      const diagnostics = ws.frames
        .map((wire) => JSON.parse(wire))
        .filter((value) => value.type === 'engine.diagnostics.event');
      expect(
        diagnostics.some(
          (value) =>
            value.event.kind === 'engine.agent.planner.started' &&
            value.event.runId,
        ),
      ).toBe(true);
      expect(
        diagnostics.every((value) => value.event.content === undefined),
      ).toBe(true);
      const change = ws.events.find((event) => event.type === 'ui_change');
      if (!change) throw new Error('Missing change');
      await handlers.message(
        client,
        frame({
          type: 'ui_applied',
          version: AGENT_WIRE_VERSION,
          changeId: change.changeId,
          chart,
          actionOutcomes: [],
        }),
      );
      await handlers.message(client, subscribe(true));
      await handlers.message(
        client,
        frame({ ...utterance(), inputId: MessageId('content-input') }),
      );
      expect(
        ws.frames
          .map((wire) => JSON.parse(wire))
          .some(
            (value) =>
              value.type === 'engine.diagnostics.event' &&
              value.event.content?.text === 'Keep the Chart empty',
          ),
      ).toBe(true);
      const count = ws.frames.length;
      const other = engine.openConnection({
        sessionId: SessionId('other-session'),
        user: null,
      });
      try {
        await other.send(utterance());
      } finally {
        other.close();
      }
      expect(ws.frames).toHaveLength(count);
    } finally {
      handlers.close?.(client, 1000, 'done');
    }
  });
});
