import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentInputMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));
const provider = vi.hoisted(() => ({
  adapter: undefined as AnyTextAdapter | undefined,
}));
vi.mock('@tanstack/ai-openai', () => ({
  createOpenaiChat: () => provider.adapter,
}));

import { type PlaygroundEnv, SessionDO } from './session-do';

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
  sessionId = SessionId('hosted-stream'),
) => encodeEnvelope(AgentInputMessage({ sessionId, input }));
const utterance = () => ({
  type: 'utterance' as const,
  version: AGENT_WIRE_VERSION,
  inputId: MessageId('hosted-input'),
  text: 'Keep the Chart empty',
  source: 'text' as const,
  chart,
});
class Socket {
  readonly frames: string[] = [];
  private attachment: unknown;
  send(wire: string) {
    this.frames.push(wire);
  }
  close() {}
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  events(): AgentEvent[] {
    return this.frames.flatMap((wire) => {
      const parsed = decodeServerEnvelope(wire);
      return parsed.ok && parsed.value.type === 'engine.agent.event'
        ? [parsed.value.event]
        : [];
    });
  }
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const hello = JSON.stringify({
  type: 'playground.hello',
  sessionId: 'hosted-stream',
  apiKey: 'sk-0123456789012345678901234567890123456789',
});
const response = JSON.stringify({
  userMessage: 'The Chart is empty.',
  rationale: '',
  executionPlan: [],
  layout: { tree: [], instances: [] },
});
function host(sockets: Socket[]) {
  return new SessionDO(
    {
      setWebSocketAutoResponse() {},
      getWebSockets: () => sockets,
    } as unknown as DurableObjectState,
    {} as PlaygroundEnv,
  );
}

it('the hosted socket streams a real Planner response and waits for its own acknowledgement', async () => {
  const adapter = fakeText();
  adapter.setResponses([{ text: response }]);
  provider.adapter = adapter;
  const socket = new Socket();
  const ws = socket as unknown as WebSocket;
  const object = host([socket]);
  try {
    await object.webSocketMessage(ws, hello);
    await object.webSocketMessage(ws, frame(utterance()));
    expect(socket.events().map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'ui_change',
    ]);
    const change = socket.events().find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    await object.webSocketMessage(
      ws,
      frame({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        actionOutcomes: [],
      }),
    );
    expect(socket.events().at(-1)).toMatchObject({
      type: 'finished',
      ok: true,
      reply: 'The Chart is empty.',
    });
    expect(adapter.state.callCount).toBe(1);
  } finally {
    await object.webSocketClose(ws);
  }
});

it('a hosted socket cannot submit another session or acknowledge another connection’s change', async () => {
  const adapter = fakeText();
  adapter.setResponses([{ text: response }]);
  provider.adapter = adapter;
  const a = new Socket();
  const b = new Socket();
  const object = host([a, b]);
  const aw = a as unknown as WebSocket;
  const bw = b as unknown as WebSocket;
  try {
    await object.webSocketMessage(aw, hello);
    await object.webSocketMessage(bw, hello);
    await object.webSocketMessage(
      aw,
      frame(utterance(), SessionId('other-session')),
    );
    expect(JSON.parse(a.frames.at(-1) ?? '')).toMatchObject({
      type: 'engine.error',
      code: 'session_mismatch',
    });
    expect(adapter.state.callCount).toBe(0);
    await object.webSocketMessage(aw, frame(utterance()));
    const change = a.events().find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    await object.webSocketMessage(
      bw,
      frame({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        actionOutcomes: [],
      }),
    );
    expect(b.events().at(-1)).toMatchObject({
      type: 'error',
      code: 'unknown_change',
    });
    expect(a.events().some((event) => event.type === 'finished')).toBe(false);
    await object.webSocketMessage(
      aw,
      frame({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        actionOutcomes: [],
      }),
    );
    expect(a.events().at(-1)).toMatchObject({ type: 'finished', ok: true });
  } finally {
    await object.webSocketClose(aw);
    await object.webSocketClose(bw);
  }
});

it.each([
  'webSocketClose',
  'webSocketError',
] as const)('%s cancels pending work and suppresses a late provider response', async (close) => {
  const adapter = fakeText();
  const entered = deferred();
  const gate = deferred();
  adapter.setResponses([
    async () => {
      entered.resolve();
      await gate.promise;
      return { text: response };
    },
  ]);
  provider.adapter = adapter;
  const socket = new Socket();
  const ws = socket as unknown as WebSocket;
  const object = host([socket]);
  await object.webSocketMessage(ws, hello);
  const sent = object.webSocketMessage(ws, frame(utterance()));
  await entered.promise;
  await object[close](ws);
  gate.resolve();
  await sent;
  expect(socket.events().map((event) => event.type)).toEqual([
    'placeholder',
    'accepted',
  ]);
  await object.webSocketMessage(
    ws,
    frame({ ...utterance(), inputId: MessageId('after-close') }),
  );
  expect(adapter.state.callCount).toBe(1);
});

it('a hibernated socket reauthenticates before replaying its buffered agent input without persisting the key', async () => {
  const adapter = fakeText();
  adapter.setResponses([{ text: response }]);
  provider.adapter = adapter;
  const socket = new Socket();
  const ws = socket as unknown as WebSocket;
  socket.serializeAttachment({ helloed: true, sessionId: 'hosted-stream' });
  const object = host([socket]);
  try {
    await object.webSocketMessage(ws, frame(utterance()));
    expect(JSON.parse(socket.frames.at(-1) ?? '')).toEqual({
      type: 'playground.rehello',
    });
    expect(adapter.state.callCount).toBe(0);
    await object.webSocketMessage(ws, hello);
    const change = socket.events().find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    await object.webSocketMessage(
      ws,
      frame({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        actionOutcomes: [],
      }),
    );
    expect(socket.events().at(-1)).toMatchObject({
      type: 'finished',
      ok: true,
    });
    expect(socket.deserializeAttachment()).toEqual({
      helloed: true,
      sessionId: 'hosted-stream',
    });
  } finally {
    await object.webSocketClose(ws);
  }
});
