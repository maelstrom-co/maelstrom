import { AguiWorkspaceSession } from '@maelstrom-co/agui-server';
import { Orchestrator } from '@maelstrom-co/client';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import {
  InstanceId,
  MessageId,
  ok,
  SessionId,
  TilingResponseSchema,
  ToolCallId,
} from '@maelstrom-co/protocol';
import {
  type RealtimeAdapterEvent,
  type RealtimeProviderAdapter,
  RealtimeSession,
  type ToolResult,
} from '@maelstrom-co/realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchFrame } from '../server/dispatch';
import { journalActions } from '../vessels/journal.store';
import { journalVessel } from '../vessels/journal.vessel.def';
import { createDemoConnector } from './connector';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(
  options: { dropTerminal?: boolean; loseAck?: boolean } = {},
) {
  vi.stubEnv('VITE_HOSTED', '0');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
  const sent: { type: string; input?: { forwardedProps: { kind: string } } }[] =
    [];
  const intents: string[] = [];
  const writes: string[] = [];
  const engine = createEngine({
    retry: false,
    history: { store: createInMemoryStore(), maxEntries: 20 },
    planner: async ({ request }) => {
      const intent = request.context.updateReasons.find(
        (r) => r.type === 'user_intent',
      );
      if (intent?.type === 'user_intent') intents.push(intent.intent);
      return ok(
        TilingResponseSchema.parse({
          userMessage: 'Workspace updated',
          rationale: '',
          layout: {
            tree: ['ID:journal'],
            instances: [
              { instanceId: 'journal', vesselId: 'journal', variant: 'entry' },
            ],
          },
          executionPlan: intent
            ? [
                {
                  instanceId: 'journal',
                  action: 'createEntry',
                  paramsJson: JSON.stringify({
                    title: intent.intent.includes('Voice')
                      ? 'Voice entry'
                      : 'Typed entry',
                  }),
                },
              ]
            : [],
        }),
      );
    },
  });
  let deliverTerminal: (() => void) | undefined;
  class Socket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    workspace: AguiWorkspaceSession | undefined;
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
    }
    send(raw: string) {
      const frame = JSON.parse(raw);
      sent.push(frame);
      if (options.loseAck && frame.input?.forwardedProps.kind === 'applied') {
        this.close(1006);
        return;
      }
      const receive = (data: string) => {
        if (this.readyState !== 1) return;
        const event = JSON.parse(data);
        if (options.dropTerminal && event.type === 'RUN_FINISHED') {
          deliverTerminal = () => this.onmessage?.({ data });
        } else this.onmessage?.({ data });
      };
      void dispatchFrame(raw, {
        helloReceived: true,
        wasHelloed: false,
        engineUnavailableReason: '',
        getEngine: () => engine,
        workspace: {
          active: () => this.workspace !== undefined,
          session: (threadId) =>
            (this.workspace ??= new AguiWorkspaceSession(threadId)),
          send: (event) => receive(JSON.stringify(event)),
        },
      }).then((result) => {
        if (result.kind === 'reply') receive(result.wire);
        if (result.kind === 'close') this.close(result.code);
      });
    }
    close(code = 1000) {
      this.readyState = 3;
      this.workspace?.close();
      queueMicrotask(() => this.onclose?.({ code, reason: '' }));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const sessionId = SessionId(crypto.randomUUID());
  const connector = createDemoConnector({ protocol: 'agui', sessionId });
  const client = new Orchestrator(connector, {
    sessionId,
    vessels: [journalVessel],
    layoutMode: 'tiling',
    readyTimeoutMs: 50,
    intentQueue: { connectionGraceMs: 50 },
  });
  cleanups.push(async () => {
    await client.dispose();
  });
  client.commandProcessor.events.on('command_complete', ({ command }) => {
    if (command.kind !== 'set_layout') return;
    client.commandProcessor.registerRunner<typeof journalVessel>(
      InstanceId('journal'),
      {
        createEntry: ({ title }) => {
          writes.push(title);
          journalActions.createEntry(title);
          return ok(undefined);
        },
      },
    );
  });
  client.chartManager.setDimensions({ columns: 12, rows: 8 });
  await client.connect();
  return {
    client,
    connector,
    sessionId,
    sent,
    writes,
    intents,
    releaseTerminal: () => deliverTerminal?.(),
  };
}

describe('AG-UI in the normal demo composition', () => {
  it('shares FIFO application and history with native voice instead of creating a second workspace writer', async () => {
    const h = await setup();
    expect(
      await h.connector.addAssistantMessageAcknowledged({
        id: MessageId(),
        message: 'Welcome to the workspace.',
      }),
    ).toBe('inserted');
    const events = new Set<(event: RealtimeAdapterEvent) => void>();
    const results: ToolResult[] = [];
    const adapter: RealtimeProviderAdapter = {
      observations: { subscribe: () => () => {} },
      connect: async () => {},
      disconnect: async () => {},
      getAudioStreams: () => ({}),
      injectGrounding: () => {},
      sendToolResult: async (_id, result) => {
        results.push(result);
      },
      on: (handler) => {
        events.add(handler);
        return () => {
          events.delete(handler);
        };
      },
    };
    const voice = new RealtimeSession({
      sessionId: h.sessionId,
      adapter,
      instance: {
        createIntentScope: () => h.client.createIntentScope(),
        submitIntent: async () => {
          throw new Error('Voice bypassed the shared FIFO');
        },
        waitForIdle: async () => {},
        getStructuralSnapshot: () => h.client.getStructuralSnapshot(),
        getCapabilitySnapshot: () => h.client.getCapabilitySnapshot(),
        onSettled: (callback) => h.client.onSettled(callback),
        addAssistantMessageAcknowledged: (message) =>
          h.connector.addAssistantMessageAcknowledged(message),
        observeEngineConnection: (callback) => {
          callback(true);
          return () => {};
        },
      },
    });
    cleanups.push(() => voice.dispose());
    await voice.connect();
    const typed = h.client.enqueueIntent('Typed entry');
    for (const listener of events)
      listener({
        type: 'tool_call',
        callId: ToolCallId('voice-call'),
        name: 'update_ui',
        argumentsJson: '{"intent":"Voice entry"}',
      });
    expect(typed.accepted).toBe(true);
    if (typed.accepted) expect((await typed.result).status).toBe('applied');
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ ok: true });
    expect(h.writes).toEqual(['Typed entry', 'Voice entry']);
    expect(h.intents[0]).toContain('Typed entry');
    expect(h.intents[1]).toContain('Voice entry');
    await vi.waitFor(() =>
      expect(
        h.sent
          .filter((f) => f.type === 'demo.agui.run')
          .map((f) => f.input?.forwardedProps.kind),
      ).toEqual(['plan', 'applied', 'plan', 'applied']),
    );
    expect(h.sent.some((f) => f.type === 'chart_request')).toBe(false);
    expect(JSON.stringify(await h.connector.getHistory(h.sessionId))).toContain(
      'Welcome to the workspace.',
    );
  });

  it('does not apply an uncommitted stream and fences it when the mode is retired', async () => {
    const h = await setup({ dropTerminal: true });
    const ticket = h.client.enqueueIntent('Typed entry');
    await vi.waitFor(() => expect(h.intents).toHaveLength(1));
    expect(h.writes).toEqual([]);
    await h.connector.disconnect();
    h.releaseTerminal();
    if (ticket.accepted)
      expect((await ticket.result).status).not.toBe('applied');
    expect(h.writes).toEqual([]);
  });

  it('does not replay a write or admit a later plan after losing its application acknowledgment', async () => {
    const h = await setup({ loseAck: true });
    const first = h.client.enqueueIntent('Typed entry');
    if (first.accepted) await first.result;
    await vi.waitFor(() => expect(h.writes).toEqual(['Typed entry']));
    const next = h.client.enqueueIntent('Another entry');
    if (next.accepted) expect((await next.result).status).not.toBe('applied');
    expect(h.writes).toEqual(['Typed entry']);
    expect(h.intents).toHaveLength(1);
  });
});
