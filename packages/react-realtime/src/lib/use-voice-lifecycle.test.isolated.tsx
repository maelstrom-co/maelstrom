import { afterEach, expect, test } from 'bun:test';
import type { IntentSubmission, Orchestrator } from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  ok,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  type MaelstromState,
  useIntentSubmission,
  vessel,
} from '@maelstrom-co/react';
import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  SessionEvent,
  ToolResult,
} from '@maelstrom-co/realtime';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import {
  type MaelstromRealtimeOptions,
  maelstromRealtime,
  type UseVoiceResult,
} from './maelstrom-realtime.js';

afterEach(cleanup);

type Provider = 'first' | 'second';

const testVessel = defineVessel({
  id: 'voice-lifecycle',
  name: 'Voice lifecycle',
  description: 'Vessel for shared voice lifecycle tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function makeAdapter(): RealtimeProviderAdapter & { active: boolean } {
  const adapter = {
    active: false,
    connect: async () => {
      adapter.active = true;
    },
    disconnect: async () => {
      adapter.active = false;
    },
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
    observations: { subscribe: () => () => {} },
  };
  return adapter;
}

function setup(
  options: Pick<
    MaelstromRealtimeOptions<Provider>,
    'onSession' | 'initialProvider' | 'greeting'
  > = {},
) {
  const adapters: ReturnType<typeof makeAdapter>[] = [];
  const m = createMaelstrom({ vessels: [vessel(testVessel, () => null)] }).with(
    maelstromRealtime({
      providers: ['first', 'second'],
      initialProvider: options.initialProvider,
      createAdapter: () => {
        const adapter = makeAdapter();
        adapters.push(adapter);
        return adapter;
      },
      onSession: options.onSession,
      greeting: options.greeting,
    }),
  );
  let voice!: UseVoiceResult<Provider>;
  function Controls() {
    voice = m.useVoice();
    return null;
  }
  const view = render(
    <m.Provider connector={createMockConnector()}>
      <Controls />
    </m.Provider>,
  );
  return { adapters, current: () => voice, unmount: view.unmount };
}

test('retained controls stop the replacement provider they connected', async () => {
  const state = setup();
  const { switchProvider, connect, disconnect } = state.current();
  await act(async () => {
    await switchProvider('second');
    await connect();
  });
  expect(state.adapters.at(-1)?.active).toBe(true);

  await act(async () => disconnect());

  expect(state.adapters.at(-1)?.active).toBe(false);
  expect(state.current().state).toBe('idle');
});

test.each([
  false,
  true,
])('releases every session when the last consumer unmounts, reentrant: %s', async (reentrant) => {
  const released: Provider[] = [];
  let unmount = () => {};
  const state = setup({
    onSession:
      (_session, { provider }) =>
      () => {
        released.push(provider);
        if (reentrant && provider === 'first') unmount();
      },
  });
  unmount = state.unmount;

  await act(async () => state.current().switchProvider('second'));
  if (!reentrant) state.unmount();
  await act(async () => Promise.resolve());

  expect(released).toEqual(['first', 'second']);
});

test('rejects a stored initial provider outside the configured list before attaching a session', () => {
  let attached = false;
  expect(() =>
    setup({
      onSession: () => {
        attached = true;
      },
      initialProvider: () => 'missing' as Provider,
    }),
  ).toThrow(RangeError);
  expect(attached).toBe(false);
});

test('rejects an empty provider list rather than passing undefined to the adapter factory', () => {
  expect(() =>
    maelstromRealtime({ providers: [], createAdapter: makeAdapter }),
  ).toThrow(RangeError);
});

test('retained greeting controls skip the current provider opening', async () => {
  const state = setup({ greeting: { text: 'Hello.' } });
  const { skipGreeting } = state.current();
  await act(async () => state.current().switchProvider('second'));

  await act(async () => skipGreeting());

  expect(state.current().greetingState).toBe('skipped');
});

test('retained stop controls do not recreate a session after its last consumer unmounts', async () => {
  const state = setup();
  const { disconnect, skipGreeting } = state.current();
  state.unmount();
  await act(async () => Promise.resolve());

  await disconnect();
  skipGreeting();

  expect(state.adapters).toHaveLength(1);
  expect(state.adapters[0]?.active).toBe(false);
});

test('React typed and provider tool intents share FIFO after a 3s resize and atomic settlement', async () => {
  const clock = FakeTimers.install({
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
  try {
    const sent: ChartRequestMessage[] = [];
    const release: Array<(response: MaelstromResponse) => void> = [];
    const connector = createMockConnector({
      process: (request) => {
        sent.push(request);
        return new Promise((resolve) => release.push(resolve));
      },
    });
    const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
    const delivered: Array<{ callId: ToolCallId; result: ToolResult }> = [];
    const events: SessionEvent[] = [];
    const adapter: RealtimeProviderAdapter = {
      ...makeAdapter(),
      on: (handler) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      sendToolResult: async (callId, result) => {
        delivered.push({ callId, result });
      },
    };
    let client!: Orchestrator;
    const m = createMaelstrom({
      vessels: [vessel(testVessel, () => null)],
      intentQueue: { capacity: 3 },
    }).with(
      maelstromRealtime({
        createAdapter: () => adapter,
        onSession: (session, context) => {
          client = context.orchestrator;
          return session.events.subscribe((event) => events.push(event));
        },
      }),
    );
    let typed!: MaelstromState;
    let voice!: UseVoiceResult;
    let observe!: (ticket: IntentSubmission) => void;
    function Controls() {
      typed = m.useMaelstrom();
      voice = m.useVoice();
      const [ticket, setTicket] = useState<IntentSubmission | null>(null);
      observe = setTicket;
      const snapshot = useIntentSubmission(ticket);
      return <output>{snapshot?.status ?? 'none'}</output>;
    }
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <m.Provider connector={connector}>
          <Controls />
        </m.Provider>,
      );
    });
    await act(async () => {
      await voice.connect();
      client.chartManager.setDimensions({ columns: 10, rows: 6 });
      await clock.tickAsync(350);
    });
    const call = (id: string) => {
      for (const handler of handlers)
        handler({
          type: 'tool_call',
          callId: ToolCallId(id),
          name: 'update_ui',
          argumentsJson: JSON.stringify({ intent: id }),
        });
    };
    let first!: IntentSubmission;
    let last!: IntentSubmission;
    await act(async () => {
      first = typed.enqueueIntent('typed-first');
      observe(first);
      call('voice-second');
      last = typed.enqueueIntent('typed-third');
      for (let columns = 11; columns <= 20; columns++) {
        client.chartManager.setDimensions({ columns, rows: 6 });
        await clock.tickAsync(300);
      }
    });
    expect(sent).toHaveLength(1);
    expect(view.getByRole('status').textContent).toBe('queued');
    expect(typed.intentScheduler.pendingCount).toBe(3);
    expect(events.filter((event) => event.type === 'tool.queued')).toHaveLength(
      1,
    );
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(0);

    const response = (index: number): MaelstromResponse => ({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      userMessage: 'Settled reply',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    let settleAction!: () => void;
    const action = new Promise<ReturnType<typeof ok<undefined>>>((resolve) => {
      settleAction = () => resolve(ok(undefined));
    });
    let layoutPrecedesAction = false;
    client.commandProcessor.registerRunner(InstanceId('introduced'), {
      show: () => {
        layoutPrecedesAction =
          client.commandProcessor.store.state.instances.has(
            InstanceId('introduced'),
          );
        return action;
      },
    });
    await act(async () => {
      release[0]({
        ...response(0),
        layout: {
          type: 'tiling',
          tree: [],
          instances: [
            {
              instanceId: InstanceId('introduced'),
              vesselId: VesselId('voice-lifecycle'),
              variant: VariantName('default'),
            },
          ],
        },
        executionPlan: [
          { instanceId: InstanceId('introduced'), action: ActionName('show') },
        ],
      });
    });
    expect(layoutPrecedesAction).toBe(true);
    expect(typed.isProcessing).toBe(false);
    expect(typed.intentScheduler.phase).toBe('applying');
    expect(sent).toHaveLength(1);
    expect(view.getByRole('status').textContent).toBe('queued');
    expect(delivered).toHaveLength(0);

    await act(async () => settleAction());
    expect(view.getByRole('status').textContent).toBe('processing');
    expect(sent[1].request.context.updateReasons).toContainEqual({
      type: 'chart_resize',
      previous: { columns: 19, rows: 6 },
      current: { columns: 20, rows: 6 },
    });
    expect(sent[1].request.instances).toEqual([
      expect.objectContaining({ instanceId: 'introduced', variant: 'default' }),
    ]);
    for (let index = 1; index <= 3; index++) {
      expect(sent).toHaveLength(index + 1);
      expect(sent[index].request.context.updateReasons.at(-1)).toEqual({
        type: 'user_intent',
        intent: ['typed-first', 'voice-second', 'typed-third'][index - 1],
      });
      await act(async () => release[index](response(index)));
      expect(view.getByRole('status').textContent).toBe('applied');
    }
    expect((await first.result).status).toBe('applied');
    expect((await last.result).status).toBe('applied');
    expect(delivered).toEqual([
      {
        callId: ToolCallId('voice-second'),
        result: {
          ok: true,
          summary: 'The screen is empty.',
          userMessage: 'Settled reply',
        },
      },
    ]);
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.result')).toHaveLength(
      1,
    );
    expect(typed.intentScheduler.phase).toBe('idle');
    expect(typed.intentScheduler.pendingCount).toBe(0);
    await act(async () => clock.tickAsync(1000));
    expect(sent).toHaveLength(4);
    expect(delivered).toHaveLength(1);
  } finally {
    cleanup();
    clock.uninstall();
  }
});
